/**
 * Direct Twitter v2 API posting for Dryad.
 * Uses the Free tier tweet creation endpoint (POST /2/tweets).
 * No timeline reads, no interactions - just posting.
 */
import { logger } from '@elizaos/core';

const TWITTER_API_KEY = process.env.TWITTER_API_KEY || '';
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || process.env.TWITTER_API_SECRET_KEY || '';
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || '';
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET || '';

function isConfigured(): boolean {
  return !!(TWITTER_API_KEY && TWITTER_API_SECRET && TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_TOKEN_SECRET);
}

/**
 * Generate OAuth 1.0a signature for Twitter API.
 * Implementation follows RFC 5849.
 */
function generateOAuthHeader(method: string, url: string, body?: Record<string, string>): string {
  const crypto = require('crypto');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // Collect all params for signature base
  const allParams = { ...oauthParams };
  if (body) Object.assign(allParams, body);

  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const signatureBase = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(TWITTER_API_SECRET)}&${encodeURIComponent(TWITTER_ACCESS_TOKEN_SECRET)}`;

  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${header}`;
}

/**
 * Post a tweet to @DryadAgent.
 * Returns the tweet ID on success, null on failure.
 */
export async function postTweet(text: string): Promise<string | null> {
  if (!isConfigured()) {
    logger.warn('[Twitter] API credentials not configured - skipping tweet');
    return null;
  }

  // Twitter limit is 280 chars
  const truncated = text.length > 280 ? text.slice(0, 277) + '...' : text;

  const url = 'https://api.twitter.com/2/tweets';
  const authHeader = generateOAuthHeader('POST', url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: truncated }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error(`[Twitter] Failed to post tweet (${response.status}): ${err}`);
      return null;
    }

    const data = (await response.json()) as { data?: { id?: string } };
    const tweetId = data?.data?.id || null;
    if (tweetId) {
      logger.info(`[Twitter] Tweet posted: ${tweetId}`);
    }
    return tweetId;
  } catch (error) {
    logger.error({ error }, '[Twitter] Error posting tweet');
    return null;
  }
}

/**
 * Post a thread (array of tweets). Each tweet replies to the previous.
 * Returns array of tweet IDs.
 */
export async function postThread(tweets: string[]): Promise<string[]> {
  if (!isConfigured()) {
    logger.warn('[Twitter] API credentials not configured - skipping thread');
    return [];
  }

  const ids: string[] = [];
  let replyToId: string | null = null;

  for (const text of tweets) {
    const truncated = text.length > 280 ? text.slice(0, 277) + '...' : text;
    const url = 'https://api.twitter.com/2/tweets';
    const authHeader = generateOAuthHeader('POST', url);

    const body: Record<string, unknown> = { text: truncated };
    if (replyToId) {
      body.reply = { in_reply_to_tweet_id: replyToId };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error(`[Twitter] Thread tweet failed (${response.status}): ${err}`);
        break;
      }

      const data = (await response.json()) as { data?: { id?: string } };
      const tweetId = data?.data?.id;
      if (tweetId) {
        ids.push(tweetId);
        replyToId = tweetId;
        logger.info(`[Twitter] Thread tweet ${ids.length}/${tweets.length}: ${tweetId}`);
      }
    } catch (error) {
      logger.error({ error }, '[Twitter] Error posting thread tweet');
      break;
    }
  }

  return ids;
}

/**
 * Get the next tweet from the queue and advance the index.
 * Returns null if queue is exhausted.
 */
export function getNextQueuedTweet(): string | null {
  const fs = require('fs');
  const path = require('path');
  const queuePath = path.join(process.cwd(), 'data', 'tweet-queue.json');

  try {
    const raw = fs.readFileSync(queuePath, 'utf-8');
    const queue = JSON.parse(raw);

    if (queue.nextIndex >= queue.tweets.length) {
      logger.info('[Twitter] Tweet queue exhausted');
      return null;
    }

    const tweet = queue.tweets[queue.nextIndex];
    queue.nextIndex += 1;
    fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
    logger.info(`[Twitter] Dequeued tweet ${queue.nextIndex}/${queue.tweets.length}`);
    return tweet;
  } catch (error) {
    logger.error({ error }, '[Twitter] Failed to read tweet queue');
    return null;
  }
}
