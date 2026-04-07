import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { sendApprovalRequest, handleCallbackQuery } from '../services/telegram.js';
import { analyzeRole, draftReply } from '../services/analyzer.js';
import { scheduleMeeting, generateTimeSlots } from '../services/calendar.js';
import { initDatabase, saveMessage, getMessage, updateMessageStatus, savePendingReply, getPendingReplies } from '../db/database.js';
import type { MessageData, WebhookMessagePayload, WebhookReplyPayload, TelegramCallbackData } from '../../../shared/types.js';

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const UNAUTHENTICATED_PATHS = ['/health', '/webhook/telegram/callback'];

const messageSchema = {
  body: {
    type: 'object',
    required: ['message_id', 'thread_id', 'sender', 'content', 'timestamp'],
    properties: {
      message_id: { type: 'string', maxLength: 128 },
      thread_id: { type: 'string', maxLength: 128 },
      sender: {
        type: 'object',
        required: ['name', 'title', 'company'],
        properties: {
          name: { type: 'string', maxLength: 100 },
          title: { type: 'string', maxLength: 200 },
          company: { type: 'string', maxLength: 200 },
        },
      },
      content: { type: 'string', maxLength: 10000 },
      timestamp: { type: 'string', maxLength: 50 },
      criteria: {
        type: 'object',
        properties: {
          minSeniority: { type: 'string', enum: ['junior', 'mid', 'senior', 'staff', 'principal'] },
          preferredTechStack: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
          avoidKeywords: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
          locations: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
          minCompensation: { type: 'number', minimum: 0 },
        },
      },
    },
  },
};

const replySchema = {
  body: {
    type: 'object',
    required: ['message_id', 'drafted_reply'],
    properties: {
      message_id: { type: 'string', maxLength: 128 },
      thread_id: { type: 'string', maxLength: 128 },
      user_choice: { type: 'string', maxLength: 50 },
      drafted_reply: { type: 'string', maxLength: 10000 },
    },
  },
};

const callbackSchema = {
  body: {
    type: 'object',
    required: ['callback_query'],
    properties: {
      callback_query: { type: 'object' },
    },
  },
};

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const db = initDatabase(config.databasePath);

  // API key validation hook
  fastify.addHook('onRequest', async (request, reply) => {
    if (UNAUTHENTICATED_PATHS.includes(request.url)) return;

    const apiKey = (request.headers['x-api-key'] as string) || '';
    if (!timingSafeEqual(apiKey, config.apiKey)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Receive messages from extension
  fastify.post('/webhook/message', { schema: messageSchema }, async (request, reply) => {
    try {
      const messageData = request.body as WebhookMessagePayload;

      // Analyze the message
      const analysis = analyzeRole(messageData);

      // Save to database
      saveMessage(db, messageData, analysis);

      // Send approval request to Telegram
      await sendApprovalRequest(messageData, config.telegramUserId);

      reply.send({
        success: true,
        message_id: messageData.message_id,
        status: 'approval_requested',
      });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Receive reply confirmations from extension
  fastify.post('/webhook/reply', { schema: replySchema }, async (request, reply) => {
    try {
      const replyData = request.body as WebhookReplyPayload;

      // Update message status in database
      updateMessageStatus(db, replyData.message_id, 'replied');

      reply.send({
        success: true,
        message_id: replyData.message_id,
        status: 'reply_delivered',
      });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Receive Telegram callback queries
  fastify.post('/webhook/telegram/callback', { schema: callbackSchema }, async (request, reply) => {
    try {
      // Validate Telegram webhook secret token
      const secretToken = (request.headers['x-telegram-bot-api-secret-token'] as string) || '';
      if (!timingSafeEqual(secretToken, config.telegramWebhookSecret)) {
        return reply.status(401).send({ error: 'Invalid webhook secret' });
      }

      const { callback_query } = request.body as { callback_query: any };

      const result = await handleCallbackQuery(callback_query);

      // Get the original message data from database
      const storedMessage = getMessage(db, result.message_id);

      const messageData: MessageData = storedMessage ? {
        message_id: storedMessage.id,
        thread_id: storedMessage.thread_id,
        sender: {
          name: storedMessage.sender_name,
          title: storedMessage.sender_title,
          company: storedMessage.sender_company,
        },
        content: storedMessage.content,
        timestamp: storedMessage.timestamp,
      } : {
        message_id: result.message_id,
        thread_id: 'thread_' + result.message_id,
        sender: {
          name: callback_query.message?.chat?.first_name || 'Recruiter',
          title: 'Technical Recruiter',
          company: 'Company',
        },
        content: 'Original recruiter message',
        timestamp: new Date().toISOString(),
      };

      let suggestedTimes: string[] | undefined;

      // If "let's talk", generate time slots and schedule meeting
      if (result.action === 'lets_talk') {
        suggestedTimes = generateTimeSlots();

        try {
          await scheduleMeeting(messageData.sender, suggestedTimes);
        } catch (calendarError) {
          fastify.log.error('Failed to schedule calendar event:', calendarError);
        }
      }

      // Draft reply based on user choice, passing suggestedTimes for dynamic slot display
      const draftedReply = draftReply(result.action, messageData, suggestedTimes);

      // Update message status
      updateMessageStatus(db, result.message_id, result.action);

      // Send the drafted reply back
      const webhookResponse: WebhookReplyPayload = {
        message_id: result.message_id,
        thread_id: messageData.thread_id,
        user_choice: result.action,
        drafted_reply: draftedReply,
        suggested_times: suggestedTimes,
      };

      // Persist reply for polling by the extension
      savePendingReply(db, webhookResponse);

      reply.send({
        success: true,
        ...webhookResponse,
      });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Poll for pending replies (called by extension)
  fastify.get('/webhook/pending-replies', async (request, reply) => {
    try {
      const replies = getPendingReplies(db);
      reply.send({ replies });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export { webhookRoutes };
