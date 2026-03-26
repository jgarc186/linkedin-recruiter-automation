import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { sendApprovalRequest, handleCallbackQuery } from '../services/telegram.js';
import { analyzeRole, draftReply } from '../services/analyzer.js';
import { scheduleMeeting, generateTimeSlots } from '../services/calendar.js';
import { initDatabase, saveMessage, getMessage, updateMessageStatus } from '../db/database.js';
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

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const bot = new TelegramBot(config.telegramBotToken, { polling: false });
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
  fastify.post('/webhook/message', async (request, reply) => {
    try {
      const messageData = request.body as WebhookMessagePayload;

      // Validate required fields
      if (!messageData.message_id || !messageData.thread_id || !messageData.sender) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

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
  fastify.post('/webhook/reply', async (request, reply) => {
    try {
      const replyData = request.body as WebhookReplyPayload;

      // Validate
      if (!replyData.message_id || !replyData.drafted_reply) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

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
  fastify.post('/webhook/telegram/callback', async (request, reply) => {
    try {
      const { callback_query } = request.body as { callback_query: TelegramBot.CallbackQuery };

      if (!callback_query) {
        return reply.status(400).send({ error: 'Missing callback_query' });
      }

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

      reply.send({
        success: true,
        ...webhookResponse,
      });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ error: 'Internal server error' });
    }
  });
};

export { webhookRoutes };
