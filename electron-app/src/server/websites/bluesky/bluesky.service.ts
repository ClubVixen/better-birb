import { Injectable } from '@nestjs/common';
import {
  DefaultOptions,
  FileRecord,
  FileSubmission,
  FileSubmissionType,
  PostResponse,
  Submission,
  SubmissionPart,
  BlueskyAccountData,
  BlueskyFileOptions,
  BlueskyNotificationOptions,
  SubmissionRating,
} from 'postybirb-commons';
import UserAccountEntity from 'src/server//account/models/user-account.entity';
import ImageManipulator from 'src/server/file-manipulation/manipulators/image.manipulator';
import { CancellationToken } from 'src/server/submission/post/cancellation/cancellation-token';
import {
  FilePostData,
  PostFile,
  PostFileRecord,
} from 'src/server/submission/post/interfaces/file-post-data.interface';
import { PostData } from 'src/server/submission/post/interfaces/post-data.interface';
import { ValidationParts } from 'src/server/submission/validator/interfaces/validation-parts.interface';
import FileSize from 'src/server/utils/filesize.util';
import WebsiteValidator from 'src/server/utils/website-validator.util';
import { LoginResponse } from '../interfaces/login-response.interface';
import { ScalingOptions } from '../interfaces/scaling-options.interface';
import { Website } from '../website.base';
import { PlaintextParser } from 'src/server/description-parsing/plaintext/plaintext.parser';
import fetch from 'node-fetch';
import { ReplyRef } from '@atproto/api/dist/client/types/app/bsky/feed/post';
import FormContent from 'src/server/utils/form-content.util';
import { JobStatus } from '@atproto/api/dist/client/types/app/bsky/video/defs';
import WaitUtil from 'src/server/utils/wait.util';
import FormData from 'form-data';
import { AtUri } from '@atproto/syntax';
import { BlobRef } from '@atproto/lexicon';
import { BskyAgent } from '@atproto/api/dist/bsky-agent';
import {
  ComAtprotoLabelDefs,
  AppBskyEmbedImages,
  AppBskyEmbedVideo,
  AppBskyFeedThreadgate,
  AppBskyVideoGetUploadLimits,
  AppBskyVideoGetJobStatus,
} from '@atproto/api/dist/client';
import { RichText } from '@atproto/api/dist/rich-text/rich-text';

import { RandomMessageService } from 'src/server/random-message/random-message.service';
import RandomMessageEntity from 'src/server/random-message/models/random-message.entity';
function ensureString(val: unknown, what = 'uri/cid'): string {
  if (typeof val !== 'string') {
    throw new Error(`Expected string for ${what}, got: ${String(val)}`);
  }
  return val;
}
function getRichTextLength(text: string): number {
  return new RichText({ text }).graphemeLength;
}

@Injectable()
export class Bluesky extends Website {
  readonly BASE_URL = '';
  readonly acceptsFiles = ['png', 'jpeg', 'jpg', 'gif', 'mp4'];
  readonly acceptsAdditionalFiles = true;
  readonly refreshInterval = 45 * 60000;
  readonly defaultDescriptionParser = PlaintextParser.parse;
  readonly MAX_CHARS = 300;
  readonly MAX_MEDIA = 4;
  readonly enableAdvertisement = false;

  /**
   * For non-repeating random messages. 
   * Key = RandomMessageEntity._id, Value = the current shuffled pool of messages.
   */
  private messagePools: Map<string, string[]> = new Map();

  constructor(
    private readonly randomMessageService: RandomMessageService,
  ) {
    super();
  }

  private makeAgent(): BskyAgent {
    // same hack as original
    globalThis.FormData = FormData as any;
    globalThis.Headers = fetch.Headers;
    globalThis.Request = fetch.Request;
    globalThis.Response = fetch.Response;
    return new BskyAgent({ service: 'https://bsky.social', fetch });
  }

  /** 
   * Shuffle a fresh copy of entity.messages if the pool is empty, 
   * then pop one message from the pool.
   */
  private getNextMessage(entity: RandomMessageEntity): string {
    let pool = this.messagePools.get(entity._id);
    if (!pool || pool.length === 0) {
      pool = [...entity.messages];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.messagePools.set(entity._id, pool);
    }
    return pool.pop()!;
  }

  async checkLoginStatus(data: UserAccountEntity): Promise<LoginResponse> {
    const username = data?.data?.username;
    const password = data?.data?.password;
    if (!username || !password) {
      return { loggedIn: false, username };
    }

    const status: LoginResponse = { loggedIn: false, username };
    const agent = this.makeAgent();
    await agent
      .login({
        identifier: username,
        password,
      })
      .then(res => {
        if (res.success) {
          status.loggedIn = true;
        } else {
          status.loggedIn = false;
        }
      })
      .catch(error => {
        status.loggedIn = false;
        this.logger.error(error);
      });

    return status;
  }

  getScalingOptions(file: FileRecord): ScalingOptions {
    return {
      maxHeight: 2000,
      maxWidth: 2000,
      maxSize: FileSize.MBtoBytes(0.9),
    };
  }

  private async uploadEmbeds(
    agent: BskyAgent,
    files: PostFileRecord[],
    fallbackAltText?: string,
  ): Promise<AppBskyEmbedImages.Main | AppBskyEmbedVideo.Main> {
    // If there's any videos, we do the video approach (only one video).
    // If there's only images, do the multiple images approach (up to 4).
    if (this.countFileTypes(files).videos !== 0) {
      // We assume the first file is the video.
      for (const file of files) {
        if (file.type === FileSubmissionType.VIDEO) {
          const altText = file.altText || fallbackAltText;
          this.logger.debug(`Bluesky: uploading video file: ${file.file.options.filename}`);
          await this.checkVideoUploadLimits(agent);
          const ref = await this.uploadVideo(agent, file.file);
          return {
            video: ref,
            alt: altText,
            $type: 'app.bsky.embed.video',
          };
        }
      }
    } else {
      // All images.
      let uploadedImages: AppBskyEmbedImages.Image[] = [];
      let fileCount = 0;
      for (const file of files) {
        const altText = file.altText || fallbackAltText;
        this.logger.debug(`Bluesky: uploading image file: ${file.file.options.filename}`);
        const ref = await this.uploadImage(agent, file.file);
        if (ref) {
          uploadedImages.push({ image: ref, alt: altText });
        }
        fileCount++;
        if (fileCount >= this.MAX_MEDIA) break;
      }
      return {
        images: uploadedImages,
        $type: 'app.bsky.embed.images',
      };
    }
  }

  private async uploadImage(agent: BskyAgent, file: PostFile): Promise<BlobRef | undefined> {
    const blobUpload = await agent
      .uploadBlob(file.value, { encoding: file.options.contentType })
      .catch((err) => {
        this.logger.warn(`Bluesky: uploadBlob image failed. ${err}`);
        return Promise.reject(this.createPostResponse({}));
      });

    if (blobUpload.success) {
      const blobRef: any = blobUpload.data.blob;
      this.logger.debug(`Bluesky: image upload success => blob cid: ${blobRef?.cid || '(no cid)'} `);
      return blobUpload.data.blob;
    }
  }

  private async checkVideoUploadLimits(agent: BskyAgent): Promise<void> {
    const token = await this.getAuthToken(
      agent,
      'did:web:video.bsky.app',
      'app.bsky.video.getUploadLimits',
    );

    const url = 'https://video.bsky.app/xrpc/app.bsky.video.getUploadLimits';
    const req: RequestInit = {
      method: 'GET',
      headers: {
        Accept: '*/*',
        authorization: `Bearer ${token}`,
        'atproto-accept-labelers': 'did:plc:ar7c4by46qjdydhdevvrndac;redact',
      },
    };
    const uploadLimits: AppBskyVideoGetUploadLimits.OutputSchema = await this.checkFetchResult(
      fetch(url, req),
    ).catch(err => {
      this.logger.error(err);
      return Promise.reject(
        this.createPostResponse({ message: 'Getting video upload limits failed', error: err }),
      );
    });

    this.logger.debug(`Bluesky: Upload Limits => ${JSON.stringify(uploadLimits)}`);
    if (!uploadLimits.canUpload) {
      throw new Error(`Not allowed to upload: ${uploadLimits.message}`);
    }
  }

  private async uploadVideo(agent: BskyAgent, file: PostFile): Promise<BlobRef> {
    const token = await this.getAuthToken(
      agent,
      `did:web:${agent.pdsUrl.hostname}`,
      'com.atproto.repo.uploadBlob',
    );
    const did = encodeURIComponent(agent.did);
    const name = encodeURIComponent(this.generateVideoName());
    const url = `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${did}&name=${name}`;
    const req: RequestInit = {
      method: 'POST',
      body: file.value,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.options.contentType,
      },
    };
    this.logger.debug(`Bluesky: about to fetch uploadVideo => ${url}`);
    const videoUpload: any = await this.checkFetchResult(fetch(url, req), true).catch(err => {
      this.logger.error(err);
      return Promise.reject(
        this.createPostResponse({
          message: 'Checking video processing status failed',
          error: err,
        }),
      );
    });
    this.logger.debug(`Bluesky: Video upload => ${JSON.stringify(videoUpload)}`);
    return this.waitForVideoProcessing(videoUpload?.jobStatus?.jobId || videoUpload.jobId);
  }

  private generateVideoName(): string {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let name = '';
    for (let i = 0; i < 12; ++i) {
      name += characters[Math.floor(Math.random() * characters.length)];
    }
    return name + '.mp4';
  }

  private async waitForVideoProcessing(jobId: string): Promise<BlobRef> {
    const encodedJobId = encodeURIComponent(jobId);
    const url = `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${encodedJobId}`;
    let jobStatus: JobStatus;
    do {
      await WaitUtil.wait(4000);
      this.logger.debug(`Bluesky: Polling video job => ${url}`);
      const req: RequestInit = {
        method: 'GET',
        headers: {
          'atproto-accept-labelers': 'did:plc:ar7c4by46qjdydhdevvrndac;redact',
        },
      };
      const res: AppBskyVideoGetJobStatus.OutputSchema = await this.checkFetchResult(
        fetch(url, req),
      ).catch(err => {
        this.logger.error(err);
        return Promise.reject(
          this.createPostResponse({
            message: 'Checking video processing status failed',
            error: err,
          }),
        );
      });
      this.logger.debug(`Bluesky: jobStatus => ${JSON.stringify(res)}`);
      jobStatus = res.jobStatus;
    } while (jobStatus.state !== 'JOB_STATE_COMPLETED' && jobStatus.state !== 'JOB_STATE_FAILED');

    if (jobStatus.state === 'JOB_STATE_COMPLETED') {
      if (jobStatus.blob) {
        this.logger.debug(`Bluesky: video job completed => blobRef: ${JSON.stringify(jobStatus.blob)}`);
        return jobStatus.blob;
      } else {
        throw new Error('No blob ref after video processing');
      }
    } else {
      throw new Error(`Video processing failed: ${jobStatus.message}`);
    }
  }

  private async checkFetchResult(
    promise: Promise<Response>,
    allowConflict: boolean = false,
  ): Promise<any> {
    const res = await promise;
    if ((res.status >= 200 && res.status < 300) || (allowConflict && res.status === 409)) {
      try {
        const body = await res.json();
        return body;
      } catch (err) {
        throw { message: `Failed to get JSON body: ${err}` };
      }
    } else {
      const body = await this.tryGetErrorBody(res);
      throw `Failed with status ${res.status} ${res.statusText}: ${body})}`;
    }
  }

  private async getAuthToken(agent: BskyAgent, aud: string, lxm: string): Promise<string> {
    this.logger.debug(`Bluesky: getAuthToken => aud=${aud} lxm=${lxm}`);
    const auth = await agent.com.atproto.server.getServiceAuth({ aud, lxm }).catch(err => {
      this.logger.error(err);
      throw this.createPostResponse({ message: `Auth for ${aud}::${lxm} failed`, error: err });
    });
    if (!auth.success) {
      throw this.createPostResponse({ message: `Auth for ${aud}::${lxm} not successful` });
    }
    return auth.data.token;
  }

  private async tryGetErrorBody(res: Response): Promise<string> {
    try {
      const body = await res.text();
      return body;
    } catch (e) {
      return `(error getting body: ${e})`;
    }
  }

  /**
   * postFileSubmission: main post + optional second reply
   */
  async postFileSubmission(
    cancellationToken: CancellationToken,
    data: FilePostData<BlueskyFileOptions>,
    accountData: BlueskyAccountData,
  ): Promise<PostResponse> {
    this.checkCancelled(cancellationToken);

    // 1) Log in
    const agent = this.makeAgent();
    await agent.login({
      identifier: accountData.username,
      password: accountData.password,
    });

    // 2) Possibly fetch & append random message
    let combinedDescription = data.description || '';
    if (data.options.useRandomMessage && data.options.randomMessageId) {
      const randomEntity = await this.randomMessageService.get(data.options.randomMessageId);
      const randomMsg = this.getNextMessage(randomEntity);
      combinedDescription += `\n\n${randomMsg}`;
      this.logger.debug(`Bluesky: appended randomMsg => ${randomMsg}`);
    }

    // 3) Create embed from images or video
    const files = [data.primary, ...data.additional];
    const embed = await this.uploadEmbeds(agent, files, data.options.altText);

    // 4) Possibly label rating
    let labelsRecord: ComAtprotoLabelDefs.SelfLabels | undefined;
    if (data.options.label_rating) {
      labelsRecord = {
        values: [{ val: data.options.label_rating }],
        $type: 'com.atproto.label.defs#selfLabels',
      };
    }

    // 5) Build RichText for the main post
    const rtMain = new RichText({ text: combinedDescription });
    await rtMain.detectFacets(agent);

    // 6) Possibly get "reply" object if user put `replyToUrl`
    const replyRef = await this.getReplyRef(agent, data.options.replyToUrl);

    // 7) Post main
    this.logger.debug(`Bluesky: about to post main. replyRef? => ${JSON.stringify(replyRef)}`);
    const mainPost = await agent
      .post({
        text: rtMain.text,
        facets: rtMain.facets,
        embed: embed,
        labels: labelsRecord,
        ...(replyRef ? { reply: replyRef } : {}),
      })
      .catch(err => {
        this.logger.error(`Bluesky: main post error => ${JSON.stringify(err)}`);
        throw this.createPostResponse({ message: err });
      });

    if (!mainPost?.uri) {
      throw this.createPostResponse({ message: 'Main post failed or no .uri returned' });
    }

    // 8) Build a friendly URL for the main post
    const profile = await agent.getProfile({ actor: agent.session.did });
    const handle = profile.data.handle;
    const server = 'bsky.app';
    const rkey = mainPost.uri.split('/').pop();
    const mainUrl = `https://${server}/profile/${handle}/post/${rkey}`;
    this.logger.debug(`Bluesky: main post => ${mainUrl}`);

    // 9) If threadgate needed
    if (data.options.threadgate) {
      this.logger.debug(`Bluesky: setting threadgate => ${data.options.threadgate}`);
      this.createThreadgate(agent, mainPost.uri, data.options.threadgate);
    }

    // 10) If user toggled a second “reply post”
    if (data.options.useReplyPost && data.options.replyMessage) {
      try {
        this.logger.debug('Bluesky: about to do second REPLY post');
        // (a) We must get the .cid from the newly posted main to reference it
        // Because we only have .uri => we can do agent.getPost to fetch more details
        const parentPost = await agent.getPost({ repo: handle, rkey });
        this.logger.debug(`Bluesky: parentPost => ${JSON.stringify(parentPost)}`);
        let rootUri: string;
        let rootCid: string;
        let parentUri: string;
        let parentCid: string;
  
        // If main was a direct top-level post (not a reply):
        // parentPost.uri => 'at://did:plc:xxx/app.bsky.feed.post/3aaaaa'
        // parentPost.cid => 'bafyre....'
        if (parentPost.value?.reply?.root) {
          // If the main is itself a reply
          rootUri = String(parentPost.value.reply.root.uri);
          rootCid = String(parentPost.value.reply.root.cid);
          parentUri = String(parentPost.uri);
          parentCid = String(parentPost.cid);
          this.logger.debug(`Bluesky: main was itself a reply => rootUri=${rootUri}`);
        } else {
          // main was a top-level post, so root=the main post
          rootUri = String(parentPost.uri);
          rootCid = String(parentPost.cid);
          parentUri = String(parentPost.uri);
          parentCid = String(parentPost.cid);
          this.logger.debug(`Bluesky: main was top-level => rootUri=${rootUri}`);
        }
        
        // (b) Build text for second post
        const rtReply = new RichText({ text: data.options.replyMessage });
        await rtReply.detectFacets(agent);

        // (d) agent.post again
        const secondPost  = await agent
        .post({
          text: rtReply.text,
          facets: rtReply.facets,
          labels: labelsRecord, // optional same rating
          reply: {
            root: { uri: rootUri, cid: rootCid },
            parent: { uri: parentUri, cid: parentCid },
          },
        })
        .catch(e => {
          this.logger.warn(`Bluesky: second reply post => failed => ${String(e)}`);
          return null;
        });


        if (secondPost?.uri) {
          const secondRkey = secondPost.uri.split('/').pop();
          const secondUrl = `https://${server}/profile/${handle}/post/${secondRkey}`;
          this.logger.log(`Bluesky: second reply post => ${secondUrl}`);

        } else {
          this.logger.debug('Bluesky: second post returned null or no .uri');
        }
      } catch (err) {
        this.logger.warn(`Failed second reply post => ${err}`);
      }
    }

    // Return success referencing the main post
    return this.createPostResponse({ source: mainUrl });
  }

  createThreadgate(agent: BskyAgent, postUri: string, fromPostThreadGate: string) {
    let allow: (
      | AppBskyFeedThreadgate.MentionRule
      | AppBskyFeedThreadgate.FollowingRule
      | AppBskyFeedThreadgate.ListRule
    )[] = [];

    switch (fromPostThreadGate) {
      case 'mention':
        allow.push({ $type: 'app.bsky.feed.threadgate#mentionRule' });
        break;
      case 'following':
        allow.push({ $type: 'app.bsky.feed.threadgate#followingRule' });
        break;
      case 'mention,following':
        allow.push({ $type: 'app.bsky.feed.threadgate#followingRule' });
        allow.push({ $type: 'app.bsky.feed.threadgate#mentionRule' });
        break;
      default:
        // no one can reply
        break;
    }

    const postUrip = new AtUri(postUri);
    this.logger.debug(`Bluesky: createThreadgate => postUri=${postUri} fromPostThreadGate=${fromPostThreadGate}`);
    agent.api.app.bsky.feed.threadgate
      .create(
        { repo: agent.session!.did, rkey: postUrip.rkey },
        { post: postUri, createdAt: new Date().toISOString(), allow },
      )
      .finally(() => {
        return;
      });
  }

  async postNotificationSubmission(
    cancellationToken: CancellationToken,
    data: PostData<Submission, BlueskyNotificationOptions>,
    accountData: BlueskyAccountData,
  ): Promise<PostResponse> {
    this.checkCancelled(cancellationToken);

    const agent = this.makeAgent();
    await agent.login({
      identifier: accountData.username,
      password: accountData.password,
    });

    let profile = await agent.getProfile({ actor: agent.session.did });

    const reply = await this.getReplyRef(agent, data.options.replyToUrl);

    let labelsRecord: ComAtprotoLabelDefs.SelfLabels | undefined;
    if (data.options.label_rating) {
      labelsRecord = {
        values: [{ val: data.options.label_rating }],
        $type: 'com.atproto.label.defs#selfLabels',
      };
    }

    const rt = new RichText({ text: data.description });
    await rt.detectFacets(agent);

    const postResult = await agent
      .post({
        text: rt.text,
        facets: rt.facets,
        labels: labelsRecord,
        ...(reply ? { reply } : {}),
      })
      .catch(err => {
        throw this.createPostResponse({ message: err });
      });

    if (postResult && postResult.uri) {
      const handle = profile.data.handle;
      const server = 'bsky.app';
      const postId = postResult.uri.slice(postResult.uri.lastIndexOf('/') + 1);
      let friendlyUrl = `https://${server}/profile/${handle}/post/${postId}`;

      if (data.options.threadgate) {
        this.createThreadgate(agent, postResult.uri, data.options.threadgate);
      }

      return this.createPostResponse({
        source: friendlyUrl,
      });
    } else {
      throw this.createPostResponse({ message: 'Unknown error occurred' });
    }
  }

  validateFileSubmission(
    submission: FileSubmission,
    submissionPart: SubmissionPart<BlueskyFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const problems: string[] = [];
    const warnings: string[] = [];
    const isAutoscaling: boolean = submissionPart.data.autoScale;

    const files = [
      submission.primary,
      ...(submission.additional || []).filter(
        f => !f.ignoredAccounts!.includes(submissionPart.accountId),
      ),
    ];
    if (!submissionPart.data.altText && files.some(f => !f.altText)) {
      problems.push(
        'Bluesky currently always requires alt text to be provided, ' +
          'even if your settings say otherwise. This is a bug on their side.',
      );
    }

    this.validateRating(submissionPart, defaultPart, warnings);
    this.validateDescription(problems, warnings, submissionPart, defaultPart);

    const { images, videos, other } = this.countFileTypes(files);
    if ((images !== 0 && videos !== 0) || videos > 1 || other !== 0) {
      problems.push('Supports either a set of images or a single video');
    }

    files.forEach(file => {
      const { type, size, name, mimetype } = file;
      if (!WebsiteValidator.supportsFileType(file, this.acceptsFiles)) {
        problems.push(`Does not support file format: (${name}) ${mimetype}.`);
      }

      // e.g. 1 MB limit for images if not video
      let maxMB: number = 1;
      if (type !== FileSubmissionType.VIDEO && FileSize.MBtoBytes(maxMB) < size) {
        if (
          isAutoscaling &&
          type === FileSubmissionType.IMAGE &&
          ImageManipulator.isMimeType(mimetype)
        ) {
          warnings.push(`${name} will be scaled down to ${maxMB}MB`);
        } else {
          problems.push(`BlueSky limits ${mimetype} to ${maxMB}MB`);
        }
      }

      if (
        isAutoscaling &&
        type === FileSubmissionType.IMAGE &&
        (file.height > 2000 || file.width > 2000)
      ) {
        warnings.push(`${name} will be scaled down to a maximum size of 2000x2000, while maintaining aspect ratio`);
      }
    });

    if (files.length > this.MAX_MEDIA) {
      warnings.push('Too many files selected for BlueSky; only the first four are used');
    }

    this.validateReplyToUrl(problems, submissionPart.data.replyToUrl);
    return { problems, warnings };
  }

  validateNotificationSubmission(
    submission: FileSubmission,
    submissionPart: SubmissionPart<BlueskyNotificationOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const problems: string[] = [];
    const warnings: string[] = [];

    this.validateDescription(problems, warnings, submissionPart, defaultPart);
    this.validateReplyToUrl(problems, submissionPart.data.replyToUrl);
    this.validateRating(submissionPart, defaultPart, warnings);

    return { problems, warnings };
  }

  private validateRating(
    submissionPart: SubmissionPart<BlueskyFileOptions | BlueskyNotificationOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
    warnings: string[],
  ) {
    const rating = submissionPart.data.rating || defaultPart.data.rating;
    if (rating) {
      if (!submissionPart.data.label_rating && rating !== SubmissionRating.GENERAL) {
        warnings.push(
          `Make sure Default rating '${rating ?? SubmissionRating.GENERAL}' matches Bluesky Label Rating.`,
        );
      }
    }
  }

  private validateDescription(
    problems: string[],
    warnings: string[],
    submissionPart: SubmissionPart<BlueskyNotificationOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): void {
    const description = this.defaultDescriptionParser(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
    );

    const rt = new RichText({ text: description });
    const agent = this.makeAgent();
    rt.detectFacets(agent);

    if (rt.graphemeLength > this.MAX_CHARS) {
      problems.push(`Max description length allowed is ${this.MAX_CHARS} characters.`);
    } else {
      if (description.toLowerCase().indexOf('{tags}') > -1) {
        this.validateInsertTags(
          warnings,
          this.formatTags(FormContent.getTags(defaultPart.data.tags, submissionPart.data.tags)),
          description,
          this.MAX_CHARS,
          getRichTextLength,
        );
      } else {
        warnings.push(`You have not inserted the {tags} shortcut in your description; tags will not appear`);
      }
    }
  }

  private validateReplyToUrl(problems: string[], url?: string): void {
    if (url?.trim() && !this.getPostIdFromUrl(url)) {
      problems.push('Invalid post URL to reply to.');
    }
  }

  private async getReplyRef(agent: BskyAgent, url?: string): Promise<ReplyRef | null> {
    if (!url?.trim()) {
      return null;
    }
    const postId = this.getPostIdFromUrl(url);
    if (!postId) {
      throw new Error(`Invalid reply to url '${url}'`);
    }
    const parent = await agent.getPost(postId);
    this.logger.debug(`Bluesky: getReplyRef => parent.value => ${JSON.stringify(parent.value)}`);
    const reply = parent.value.reply;
    const root = reply ? reply.root : parent;
    return {
      root: { uri: root.uri, cid: root.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    };
  }

  private getPostIdFromUrl(url: string): { repo: string; rkey: string } | null {
    const link = /\/profile\/([^\/]+)\/post\/([a-zA-Z0-9\.\-_~]+)/.exec(url);
    if (link) {
      return { repo: link[1], rkey: link[2] };
    }
    const at = /(did:plc:[a-zA-Z0-9\.\-_~]+)\/.+\.post\/([a-zA-Z0-9\.\-_~]+)/.exec(url);
    if (at) {
      return { repo: at[1], rkey: at[2] };
    }
    return null;
  }

  private countFileTypes(files: { type: FileSubmissionType }[]): {
    images: number;
    videos: number;
    other: number;
  } {
    const counts = { images: 0, videos: 0, other: 0 };
    for (const file of files) {
      if (file.type === FileSubmissionType.VIDEO) {
        ++counts.videos;
      } else if (file.type === FileSubmissionType.IMAGE) {
        ++counts.images;
      } else {
        ++counts.other;
      }
    }
    return counts;
  }
}
