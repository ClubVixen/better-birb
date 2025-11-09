import { Injectable, Logger } from '@nestjs/common';
import * as _ from 'lodash';
import * as request from 'request';
import Twitter, { AccessTokenResponse, TwitterOptions } from 'twitter-lite';
import {
  ContentBlurType,
  ESensitiveMediaWarnings_Utils,
} from './enums/twitter-sensitive-media-warnings.enum';
import { ImediaMetadataBody } from './interfaces/twitter-media-metadata-body.interface';
import { ApiResponse } from './models/api-response.model';
import { RequestFile, SubmissionPost } from './models/submission-post.model';
import { TwitterAuthorization } from './models/twitter-authorization.model';

type ApiData = {
  key: string;
  secret: string;
};

// Typings borrowed from twitter-api-v2
type TTweetReplySettingsV2 = 'mentionedUsers' | 'following' | 'everyone';
interface SendTweetV2Params {
  direct_message_deep_link?: string;
  for_super_followers_only?: 'True' | 'False';
  geo?: {
    place_id: string;
  };
  media?: {
    media_ids?: string[];
    tagged_user_ids?: string[];
  };
  poll?: {
    duration_minutes: number;
    options: string[];
  };
  quote_tweet_id?: string;
  reply?: {
    exclude_reply_user_ids?: string[];
    in_reply_to_tweet_id: string;
  };
  reply_settings?: TTweetReplySettingsV2 | string;
  text?: string;
}

interface TwitterOAuth {
  consumer_key: string;
  consumer_secret: string;
  token: string;
  token_secret: string;
}

@Injectable()
export class TwitterAPIService {
  private readonly logger = new Logger(TwitterAPIService.name);
  private readonly MAX_FILE_CHUNK: number = 5 * 1024 * 1024;

  private getClient(apiKeys: ApiData, token?: any, version?: string) {
    const config: TwitterOptions = {
      consumer_key: apiKeys.key,
      consumer_secret: apiKeys.secret,
      version: version || '1.1',
      extension: version === '2' ? false : true,
    };
    if (token) {
      config.access_token_key = token.oauth_token;
      config.access_token_secret = token.oauth_token_secret;
    }
    return new Twitter(config);
  }

  async startAuthorization(
    data: ApiData,
  ): Promise<ApiResponse<{ url: string; oauth_token: string }>> {
    try {
      const auth = await this.getClient(data).getRequestToken('oob');
      return new ApiResponse({
        data: {
          url: `https://api.twitter.com/oauth/authenticate?oauth_token=${
            (auth as any).oauth_token
          }`,
          oauth_token: (auth as any).oauth_token,
        },
      });
    } catch (err) {
      this.logger.error(err, err.stack, 'Twitter Auth Start Failure');
      return new ApiResponse({ error: err });
    }
  }

  async completeAuthorization(
    data: TwitterAuthorization,
  ): Promise<ApiResponse<AccessTokenResponse>> {
    try {
      const auth = await this.getClient({ key: data.key, secret: data.secret }).getAccessToken({
        oauth_token: data.oauth_token,
        oauth_verifier: data.verifier,
      });
      return new ApiResponse({ data: auth });
    } catch (err) {
      this.logger.error(err, err.stack, 'Twitter Auth Complete Failure');
      return new ApiResponse({ error: err });
    }
  }

  async post(
    apiKeys: ApiData,
    data: SubmissionPost<{ contentBlur: ContentBlurType }>,
    replyToId?: string,
  ): Promise<ApiResponse<{ url: string; id?: string }>> {
    const client = this.getClient(apiKeys, {
      oauth_token: data.token,
      oauth_token_secret: data.secret,
    });

    const tokens = client['token'];
    const oauth: TwitterOAuth = {
      consumer_key: apiKeys.key,
      consumer_secret: apiKeys.secret,
      token: tokens.key,
      token_secret: tokens.secret,
    };

    const tweets: SendTweetV2Params[] = [];
    const tweet: SendTweetV2Params = {
      text: data.description || '',
    };

    if (replyToId) {
      tweet.reply = { in_reply_to_tweet_id: replyToId };
    }

    tweet.text = tweet?.text || '';

    let mediaIds = [];
    if (data.files.length) {
      try {
        mediaIds = await Promise.all(
          data.getFilesforPost().map(file => this.uploadMedia(oauth, file)),
        );

        const twitterSMW =
          ESensitiveMediaWarnings_Utils.getSMWFromContentBlur(data?.options?.contentBlur) ??
          undefined;
        if (twitterSMW) {
          await Promise.all(
            mediaIds.map(mediaId => {
              const mediaMdBody: ImediaMetadataBody = {
                media_id: mediaId,
                sensitive_media_warning: [twitterSMW],
              };
              return this.createMediaMetadata(oauth, mediaMdBody);
            }),
          );
        }
      } catch (err) {
        this.logger.error(err, err.stack, 'Failed to upload files to Twitter');
        return new ApiResponse({
          error: Array.isArray(err) ? err.map(e => e.message).join('\n') : err,
        });
      }

      const ids = _.chunk(mediaIds, 4);
      ids.forEach((idGroup, i) => {
        const t = { ...tweet, media: { media_ids: idGroup } };
        if (ids.length > 1) {
          if (i === 0) {
            const numberedStatus = `${i + 1}/${ids.length} ${t.text}`;
            if (numberedStatus.length <= 280) {
              t.text = numberedStatus;
            }
          }
          if (i > 0) {
            t.text = `${i + 1}/${ids.length}`;
          }
        }
        tweets.push(t);
      });
    } else {
      tweets.push(tweet);
    }

    try {
      let url: string = '';
      let currentReplyId: string | undefined;
      for (const t of tweets) {
        if (currentReplyId) {
          t.reply = {
            in_reply_to_tweet_id: currentReplyId,
          };
        }
        const post = await this.postTweet(t, oauth);
        const postedId = post.data?.id;
        const me = await this.getAuthenticatedUser(oauth);
        this.logger.debug(`Raw Tweet Response from Twitter:\n${JSON.stringify(post, null, 2)}`);
        this.logger.debug(`Parsed tweet ID: ${postedId}`);
        if (!url) {
          url = `https://twitter.com/${me.data.username}/status/${postedId}`;
        }
        currentReplyId = postedId;
      }

      return new ApiResponse({
        data: {
          url,
          id: currentReplyId,
        },
      });
    } catch (err) {
      this.logger.error(err, '', 'Failed to post');
      return new ApiResponse({
        error: Array.isArray(err) ? err.map(e => e.message).join('\n') : err,
      });
    }
  }

  private getAuthenticatedUser(oauth: any): Promise<any> {
    const url = 'https://api.twitter.com/2/users/me';
    return new Promise((resolve, reject) => {
      request.get(
        url,
        {
          json: true,
          oauth,
        },
        (err, res, body) => {
          if (body && body.errors) {
            reject(body.errors);
          } else {
            resolve(body);
          }
        },
      );
    });
  }

  private postTweet(form: any, oauth: any): Promise<any> {
    const url = 'https://api.twitter.com/2/tweets';
    return new Promise((resolve, reject) => {
      request.post(
        url,
        {
          json: true,
          body: form,
          oauth,
        },
        (err, res, body) => {
          if (body && body.errors) {
            reject(body.errors);
          } else {
            resolve(body);
          }
        },
      );
    });
  }

  private createMediaMetadata(oauth: any, body: ImediaMetadataBody): Promise<any> {
    const url = 'https://upload.twitter.com/1.1/media/metadata/create.json';
    this.logger.debug(`[Media Metadata] Posting to ${url} with body: ${JSON.stringify(body)}`);

    return new Promise((resolve, reject) => {
      request.post(
        url,
        {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          oauth,
        },
        (err, res, responseBody) => {
          if (err) {
            this.logger.error('[Media Metadata] Request error', err);
            return reject(err);
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.logger.debug(`[Media Metadata] Success with status ${res.statusCode}`);
            return resolve(responseBody);
          }

          this.logger.error(
            `[Media Metadata] Error response. Status: ${res.statusCode}, Body: ${responseBody}`,
          );
          let parsedBody;
          try {
            parsedBody = JSON.parse(responseBody);
          } catch (e) {
            parsedBody = { errors: [{ message: responseBody || `HTTP ${res.statusCode}` }] };
          }

          const errorMessages = (parsedBody.errors || [])
            .map((e: any) => e.message)
            .join('; ');
          reject(
            new Error(
              errorMessages || `Failed to create media metadata, status code: ${res.statusCode}`,
            ),
          );
        },
      );
    });
  }

  private async uploadMedia(oauth: TwitterOAuth, file: RequestFile): Promise<string> {
    let mediaCategory = 'tweet_image';
    if (file.options.contentType === 'image/gif') {
      mediaCategory = 'tweet_gif';
    } else if (!file.options.contentType.includes('image')) {
      mediaCategory = 'tweet_video';
    }

    const initForm = {
      command: 'INIT',
      media_type: file.options.contentType,
      total_bytes: file.value.length,
      media_category: mediaCategory,
    };

    const mediaData: any = await this.performUploadRequest(oauth, { form: initForm });

    const { media_id_string } = mediaData;
    const chunks = _.chunk(file.value, this.MAX_FILE_CHUNK);
    await Promise.all(
      chunks.map((chunk, i) =>
        this.performUploadRequest(oauth, {
          formData: {
            command: 'APPEND',
            media_id: media_id_string,
            media_data: Buffer.from(chunk).toString('base64'),
            segment_index: i,
          },
        }),
      ),
    );

    const finalizeResponse = await this.performUploadRequest(oauth, {
      form: {
        command: 'FINALIZE',
        media_id: media_id_string,
      },
    });

    if (finalizeResponse && finalizeResponse.processing_info) {
      await this.waitForMediaProcessing(oauth, media_id_string);
    }

    return media_id_string;
  }

  private async waitForMediaProcessing(oauth: TwitterOAuth, mediaId: string): Promise<void> {
    let processing = true;
    let attempts = 0;
    const maxAttempts = 20;

    while (processing && attempts < maxAttempts) {
      attempts++;
      const statusResponse = await this.checkMediaStatus(oauth, mediaId, attempts);
      const processingInfo = statusResponse.processing_info;

      if (!processingInfo || processingInfo.state === 'succeeded') {
        processing = false;
      } else if (processingInfo.state === 'failed') {
        const errorMessage = processingInfo.error?.message || 'Unknown processing error';
        throw new Error(`Media processing failed: ${errorMessage}`);
      } else {
        const waitTime = (processingInfo.check_after_secs || 5) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error(`Media processing timed out after ${maxAttempts} attempts`);
    }
  }

  private checkMediaStatus(oauth: TwitterOAuth, mediaId: string, attempt: number): Promise<any> {
    this.logger.debug(`[Media Status] Checking status for ${mediaId} (attempt ${attempt})`);
    return this.performUploadRequest(
      oauth,
      {
        qs: {
          command: 'STATUS',
          media_id: mediaId,
        },
      },
      'get',
    );
  }

  private performUploadRequest(
    oauth: TwitterOAuth,
    options: request.CoreOptions,
    method: 'post' | 'get' = 'post',
  ): Promise<any> {
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    return new Promise((resolve, reject) => {
      request[method](
        url,
        {
          ...options,
          oauth,
        },
        (err, res, body) => {
          if (err) return reject(err);
          let parsedBody = body;
          try {
            parsedBody = JSON.parse(body);
          } catch (e) {
            // Ignore if body is not JSON
          }
          if (parsedBody && parsedBody.errors) return reject(parsedBody.errors);
          if (res.statusCode < 200 || res.statusCode >= 300)
            return reject(
              new Error(`Request failed with status code ${res.statusCode}: ${body}`),
            );
          resolve(parsedBody);
        },
      );
    });
  }
}
