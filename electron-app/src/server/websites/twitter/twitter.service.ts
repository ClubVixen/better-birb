import { Injectable } from '@nestjs/common';
import {
  DefaultOptions,
  FileRecord,
  FileSubmission,
  FileSubmissionType,
  PostResponse,
  Submission,
  SubmissionPart,
  TwitterAccountData,
  TwitterFileOptions,
} from 'postybirb-commons';
import UserAccountEntity from 'src/server//account/models/user-account.entity';
import { UsernameParser } from 'src/server/description-parsing/miscellaneous/username.parser';
import { PlaintextParser } from 'src/server/description-parsing/plaintext/plaintext.parser';
import ImageManipulator from 'src/server/file-manipulation/manipulators/image.manipulator';
import { CancellationToken } from 'src/server/submission/post/cancellation/cancellation-token';
import { FilePostData } from 'src/server/submission/post/interfaces/file-post-data.interface';
import { PostData } from 'src/server/submission/post/interfaces/post-data.interface';
import { ValidationParts } from 'src/server/submission/validator/interfaces/validation-parts.interface';
import FileSize from 'src/server/utils/filesize.util';
import FormContent from 'src/server/utils/form-content.util';
import WebsiteValidator from 'src/server/utils/website-validator.util';
import { LoginResponse } from '../interfaces/login-response.interface';
import { ScalingOptions } from '../interfaces/scaling-options.interface';
import { Website } from '../website.base';
import { ContentBlurType } from './enums/twitter-sensitive-media-warnings.enum';
import { SubmissionPost } from './models/submission-post.model';
import { TwitterAPIService } from './twitter-api.service';

import { RandomMessageService } from 'src/server/random-message/random-message.service';
import RandomMessageEntity from 'src/server/random-message/models/random-message.entity';

@Injectable()
export class Twitter extends Website {
  /** 
   * Implementation of required abstract members/properties 
   * from the Website base class
   */
  MAX_CHARS: number = 280;
  readonly BASE_URL = '';
  readonly acceptsAdditionalFiles = true;
  readonly enableAdvertisement = false;
  readonly defaultDescriptionParser = PlaintextParser.parse;
  readonly acceptsFiles = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'mp4', 'mov'];
  readonly usernameShortcuts = [
    {
      key: 'tw',
      url: 'https://twitter.com/$1',
    },
  ];

  /**
   * Map from a RandomMessageEntity._id => shuffled array of messages
   * so we don't repeat any message until they've all been used.
   */
  private messagePools: Map<string, string[]> = new Map();

  constructor(
    private readonly api: TwitterAPIService,
    private readonly randomMessageService: RandomMessageService,
  ) {
    super();
  }

  /**
   * Non-repeating approach:
   * If we don't have a pool or it's empty, shuffle a new copy from entity.messages.
   * Then pop one.
   */
  private getNextMessage(entity: RandomMessageEntity): string {
    let pool = this.messagePools.get(entity._id);
    if (!pool || pool.length === 0) {
      pool = [...entity.messages];
      // shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.messagePools.set(entity._id, pool);
    }
    return pool.pop()!;
  }

  /**
   * Post file submission to Twitter, optionally appending a random message
   * from a chosen RandomMessageEntity (if data.options.randomMessageId is set).
   */
  async postFileSubmission(
    cancellationToken: CancellationToken,
    data: FilePostData<TwitterFileOptions>,
    accountData: TwitterAccountData
  ): Promise<PostResponse> {
    this.checkCancelled(cancellationToken);

    // Start with the user-provided description
    let combinedDescription = data.description || '';

    // If user has chosen a randomMessageId, append a random message from that set
    if (data.options.randomMessageId) {
      const randomEntity: RandomMessageEntity = await this.randomMessageService.get(
        data.options.randomMessageId
      );
      const randomMsg = this.getNextMessage(randomEntity);
      combinedDescription += `\n\n${randomMsg}`;
    }

    // post the main tweet
    const mainForm  = new SubmissionPost<{
      contentBlur: ContentBlurType;
    }>({
      token: accountData.oauth_token,
      secret: accountData.oauth_token_secret,
      title: '',
      description: combinedDescription,
      tags: data.tags,
      files: [data.primary, ...data.additional].map(f => ({
        data: f.file.value.toString('base64'),
        ...f.file.options,
      })),
      rating: data.rating,
      options: {
        contentBlur: data.options?.contentBlur
      }
    });

    this.checkCancelled(cancellationToken);
    const mainTweetResult = await this.api.post(
        
      { key: accountData.key, secret: accountData.secret },
      mainForm 
    );
    

    if (!mainTweetResult.success) {
      return Promise.reject(
        this.createPostResponse({ 
          additionalInfo: mainTweetResult, 
          message: mainTweetResult.error 
        })
      );
    }



     // mainTweetResult.data.url => link
  // mainTweetResult.data.id  => numeric tweet ID for replies
  const mainId = mainTweetResult.data.id;
  this.logger.log(`Main tweet ID: ${mainId}`);
  
  

    // 4) If user toggled "Reply Tweet," do it now
    if (data.options.useReplyTweet && data.options.replyMessage) {
      const replyText = data.options.replyMessage || '';
      const replyForm = new SubmissionPost<{ contentBlur: ContentBlurType }>({
        token: accountData.oauth_token,
        secret: accountData.oauth_token_secret,
        title: '',
        description: replyText,
        tags: [], // no tags for the reply, presumably
        files: [], // no images
        rating: data.rating,
        options: {
          contentBlur: undefined
        }
      });

      this.logger.debug(`Sending second tweet with in_reply_to: ${mainId}`);
      const replyResult = await this.api.post(
        { key: accountData.key, secret: accountData.secret },
        replyForm,
        mainId, // <--- pass the ID so the tweet is a reply
      );

      if (!replyResult.success) {
        this.logger.warn(`Failed to post reply tweet: ${replyResult.error}`);
      } else {
        this.logger.log(`Reply tweet posted: ${replyResult.data.url}`);
      }
    }

    // Finally, return a success referencing your main tweet
  return this.createPostResponse({ source: mainTweetResult.data.url });
  }


  /** 
   * Standard transformations & validations
   */
  transformAccountData(data: TwitterAccountData): object {
    return { key: data.key, secret: data.secret };
  }

  getScalingOptions(file: FileRecord): ScalingOptions {
    return { maxSize: FileSize.MBtoBytes(5) };
  }

  preparseDescription(text: string) {
    return UsernameParser.replaceText(text, 'tw', '@$1');
  }

  formatTags(tags: string[]) {
    return this.parseTags(
      tags.map(tag => tag.replace(/[^a-z0-9]/gi, ' ')).map(tag => tag.split(' ').join('')),
      { spaceReplacer: '_' },
    ).map(tag => `#${tag}`);
  }

  async checkLoginStatus(data: UserAccountEntity): Promise<LoginResponse> {
    const status: LoginResponse = { loggedIn: false, username: null };
    const accountData: TwitterAccountData = data.data;
    if (accountData && accountData.oauth_token) {
      status.loggedIn = true;
      status.username = accountData.screen_name;
    }
    return status;
  }

  /**
   * Post notification submission (unchanged)
   */
  async postNotificationSubmission(
    cancellationToken: CancellationToken,
    data: PostData<Submission, DefaultOptions>,
    accountData: TwitterAccountData,
  ): Promise<PostResponse> {
    const form = new SubmissionPost<{
      contentBlur: ContentBlurType;
    }>({
      token: accountData.oauth_token,
      secret: accountData.oauth_token_secret,
      title: '',
      description: data.description,
      tags: data.tags,
      rating: data.rating,
      options: {
        contentBlur: undefined,
      },
    });

    this.checkCancelled(cancellationToken);
    const post = await this.api.post({ key: accountData.key, secret: accountData.secret }, form);
    if (post.success) {
      return this.createPostResponse({ source: post.data.url });
    }

    return Promise.reject(this.createPostResponse({ additionalInfo: post, message: post.error }));
  }

  /**
   * Validation checks 
   */
  validateFileSubmission(
    submission: FileSubmission,
    submissionPart: SubmissionPart<TwitterFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const problems: string[] = [];
    const warnings: string[] = [];
    const isAutoscaling: boolean = submissionPart.data.autoScale;

    const description = PlaintextParser.parse(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
      23,
    );

    if (description.length > 280) {
      warnings.push(
        `Approximated description may surpass 280 character limit (${description.length})`,
      );
    } else {
      if (description.toLowerCase().indexOf('{tags}') > -1) {
        this.validateInsertTags(
          warnings,
          this.formatTags(FormContent.getTags(defaultPart.data.tags, submissionPart.data.tags)),
          description,
          280,
        );
      } else {
        warnings.push(`You have not inserted the {tags} shortcut in your description; 
          tags will not be inserted in your post`);
      }
    }

    const files = [
      submission.primary,
      ...(submission.additional || []).filter(
        f => !f.ignoredAccounts!.includes(submissionPart.accountId),
      ),
    ];

    files.forEach(file => {
      const { type, size, name, mimetype } = file;
      if (!WebsiteValidator.supportsFileType(file, this.acceptsFiles)) {
        problems.push(`Does not support file format: (${name}) ${mimetype}.`);
      }

      let maxMB: number = mimetype === 'image/gif' ? 15 : 5;
      if (type === FileSubmissionType.VIDEO) {
        maxMB = 15;
      }
      if (FileSize.MBtoBytes(maxMB) < size) {
        if (
          isAutoscaling &&
          type === FileSubmissionType.IMAGE &&
          ImageManipulator.isMimeType(mimetype)
        ) {
          warnings.push(`${name} will be scaled down to ${maxMB}MB`);
        } else {
          problems.push(`Twitter limits ${mimetype} to ${maxMB}MB`);
        }
      }
    });

    return { problems, warnings };
  }

  validateNotificationSubmission(
    submission: Submission,
    submissionPart: SubmissionPart<TwitterFileOptions>,
    defaultPart: SubmissionPart<DefaultOptions>,
  ): ValidationParts {
    const warnings: string[] = [];

    const description = PlaintextParser.parse(
      FormContent.getDescription(defaultPart.data.description, submissionPart.data.description),
      23,
    );

    if (description.length > 280) {
      warnings.push(
        `Approximated description may surpass 280 character limit (${description.length})`,
      );
    } else {
      if (description.toLowerCase().indexOf('{tags}') > -1) {
        this.validateInsertTags(
          warnings,
          this.formatTags(FormContent.getTags(defaultPart.data.tags, submissionPart.data.tags)),
          description,
          280,
        );
      } else {
        warnings.push(`You have not inserted the {tags} shortcut in your description; 
          tags will not be inserted in your post`);
      }
    }

    return { problems: [], warnings };
  }
}
