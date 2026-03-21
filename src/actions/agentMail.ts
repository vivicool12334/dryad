import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0';
const INBOX_ID = 'dryad@agentmail.to';

const EMAIL_FOOTER = `\n\n---\nThis email was sent by Dryad, an autonomous AI agent managing native habitat restoration on 25th Street, Detroit. Dryad is part of The Forest That Owns Itself project. For questions or concerns, contact Nick George at powahgen@gmail.com.`;

function getApiKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('AGENTMAIL_API_KEY not configured');
  return key;
}

async function agentMailFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AgentMail API ${res.status}: ${body}`);
  }

  return res.json();
}

/** Send an email programmatically (used by decision loop). */
export async function sendDryadEmail(to: string, subject: string, body: string): Promise<any> {
  return agentMailFetch(`/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, {
    method: 'POST',
    body: JSON.stringify({ to: [to], subject, text: body + EMAIL_FOOTER }),
  });
}

function parseEmailFromMessage(text: string): { to: string | null; subject: string | null; body: string } {
  // Extract email address
  const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const to = emailMatch ? emailMatch[0] : null;

  // Extract subject (look for "subject:" or "re:" patterns)
  const subjectMatch = text.match(/subject[:\s]+["']?([^"'\n]+)["']?/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : null;

  return { to, subject, body: text };
}

export const sendEmailAction: Action = {
  name: 'SEND_EMAIL',
  similes: ['EMAIL', 'SEND_MAIL', 'WRITE_EMAIL', 'MAIL'],
  description:
    'Send an email from dryad@agentmail.to. Provide recipient address, subject, and message body.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    return !!process.env.AGENTMAIL_API_KEY;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Sending email via AgentMail');

      const { to, subject, body } = parseEmailFromMessage(message.content.text || '');

      if (!to) {
        const errorMsg = 'Please provide a recipient email address.';
        await callback({ text: errorMsg, actions: ['SEND_EMAIL'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      const emailSubject = subject || 'Message from Dryad - Land Management Agent';

      // Generate email body using the agent's context
      const emailBody = body.replace(/(?:send|email|mail)\s+(?:to\s+)?[\w.+-]+@[\w.-]+\.\w+/i, '').trim();

      const result = await agentMailFetch(`/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, {
        method: 'POST',
        body: JSON.stringify({
          to: [to],
          subject: emailSubject,
          text: (emailBody || `This is an automated message from Dryad, an autonomous land management AI agent managing 9 vacant lots on 25th Street in Detroit, MI.`) + EMAIL_FOOTER,
        }),
      });

      const responseText = `## Email Sent

**From:** dryad@agentmail.to
**To:** ${to}
**Subject:** ${emailSubject}
**Status:** ✅ Delivered

Message ID: ${result.message_id || 'sent'}`;

      await callback({
        text: responseText,
        actions: ['SEND_EMAIL'],
        source: message.content.source,
      });

      return {
        text: `Email sent to ${to}`,
        values: { success: true, to, subject: emailSubject },
        data: result,
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in SEND_EMAIL action');
      const errorMsg = `Failed to send email: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['SEND_EMAIL'], source: message.content.source });
      return {
        text: errorMsg,
        values: { success: false },
        data: {},
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Send an email to contractor@example.com subject: Invasive removal scheduled. The removal crew will arrive Monday at 9am for the 3920 lot.' } },
      {
        name: 'Dryad',
        content: { text: 'Sending email to contractor@example.com about invasive removal scheduling...', actions: ['SEND_EMAIL'] },
      },
    ],
  ],
};

export const checkEmailAction: Action = {
  name: 'CHECK_EMAIL',
  similes: ['READ_EMAIL', 'CHECK_INBOX', 'GET_MAIL', 'READ_MAIL', 'INBOX'],
  description:
    'Check the dryad@agentmail.to inbox for recent messages.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    return !!process.env.AGENTMAIL_API_KEY;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Checking email inbox');

      const result = await agentMailFetch(
        `/inboxes/${encodeURIComponent(INBOX_ID)}/messages?limit=10`
      );

      const messages = result.messages || [];

      let responseText: string;

      if (messages.length === 0) {
        responseText = `## Inbox — dryad@agentmail.to\n\nNo messages found.`;
      } else {
        const messageList = messages
          .map((msg: any, i: number) => {
            const from = msg.from || 'Unknown';
            const subject = msg.subject || '(no subject)';
            const date = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'Unknown';
            const preview = msg.preview || msg.text?.slice(0, 100) || '';
            return `### ${i + 1}. ${subject}\n**From:** ${from}\n**Date:** ${date}\n${preview ? `> ${preview}` : ''}`;
          })
          .join('\n\n');

        responseText = `## Inbox — dryad@agentmail.to\n\n**${messages.length} message(s)**\n\n${messageList}`;
      }

      await callback({
        text: responseText,
        actions: ['CHECK_EMAIL'],
        source: message.content.source,
      });

      return {
        text: `Inbox checked. ${messages.length} messages found.`,
        values: { success: true, messageCount: messages.length },
        data: { messages },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in CHECK_EMAIL action');
      const errorMsg = `Failed to check email: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['CHECK_EMAIL'], source: message.content.source });
      return {
        text: errorMsg,
        values: { success: false },
        data: {},
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Check your email' } },
      {
        name: 'Dryad',
        content: { text: 'Checking the inbox at dryad@agentmail.to...', actions: ['CHECK_EMAIL'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'Any new messages?' } },
      {
        name: 'Dryad',
        content: { text: 'Let me check for new messages...', actions: ['CHECK_EMAIL'] },
      },
    ],
  ],
};
