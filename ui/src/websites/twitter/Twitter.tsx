import { Form, Radio, Checkbox, Select, Input } from 'antd';
import {
  DefaultFileOptions,
  DefaultOptions,
  FileSubmission,
  Submission,
  SubmissionRating,
  TwitterFileOptions,
} from 'postybirb-commons';
import { observer, inject } from 'mobx-react';
import React from 'react';
import { WebsiteSectionProps } from '../form-sections/website-form-section.interface';
import GenericFileSubmissionSection from '../generic/GenericFileSubmissionSection';
import GenericSubmissionSection from '../generic/GenericSubmissionSection';
import { LoginDialogProps } from '../interfaces/website.interface';
import { WebsiteImpl } from '../website.base';
import { TwitterLogin } from './TwitterLogin';
import { RandomMessageStore } from '../../stores/random-message.store'; // <-- If you have a store


export class Twitter extends WebsiteImpl {
  internalName: string = 'Twitter';
  name: string = 'Twitter';
  supportsAdditionalFiles: boolean = true;
  supportsTags = false;
  loginUrl: string = '';

  LoginDialog = (props: LoginDialogProps) => <TwitterLogin {...props} />;

  FileSubmissionForm = (props: WebsiteSectionProps<FileSubmission, TwitterFileOptions>) => (
    <TwitterFileSubmissionForm
      key={props.part.accountId}
      {...props}
      hideThumbnailOptions={true}
      hideTitle={true}
      tagOptions={{ show: false }}
      descriptionOptions={{ show: true, options: { anchorLength: 23 } }}
      ratingOptions={{
        show: true,
        ratings: [
          { name: 'Safe', value: SubmissionRating.GENERAL },
          { name: 'Sensitive', value: SubmissionRating.ADULT },
        ],
      }}
    />
  );

  NotificationSubmissionForm = (props: WebsiteSectionProps<Submission, DefaultOptions>) => (
    <GenericSubmissionSection
      key={props.part.accountId}
      {...props}
      hideTitle={true}
      tagOptions={{ show: false }}
      descriptionOptions={{ show: true, options: { anchorLength: 23 } }}
      ratingOptions={{
        show: true,
        ratings: [
          { name: 'Safe', value: SubmissionRating.GENERAL },
          { name: 'Sensitive', value: SubmissionRating.ADULT },
        ],
      }}
    />
  );
}
@inject('randomMessageStore')
@observer
export class TwitterFileSubmissionForm extends GenericFileSubmissionSection<TwitterFileOptions> {
  get randomMessageStore(): RandomMessageStore | undefined {
    return (this.props as any).randomMessageStore;
  }
  renderLeftForm(data: TwitterFileOptions) {
    const elements = super.renderLeftForm(data);
    elements.push(
      <Form.Item label="Content Blur">
        <Radio.Group
          onChange={this.handleValueChange.bind(this, 'contentBlur')}
          value={data.contentBlur}
          buttonStyle="solid"
        >
          <Radio.Button value={undefined}>None</Radio.Button>
          <Radio.Button value="other">Other</Radio.Button>
          <Radio.Button value="adult_content">Adult Content</Radio.Button>
          <Radio.Button value="graphic_violence">Graphic Violence</Radio.Button>
        </Radio.Group>
      </Form.Item>,
    );

     // “Use Random Message?” checkbox
     elements.push(
      <Form.Item key="useRandomMessage">
        <Checkbox
          checked={!!data.useRandomMessage}
          onChange={this.handleCheckedChange.bind(this, 'useRandomMessage')}
        >
          Use Random Message?
        </Checkbox>
      </Form.Item>
    );

    // If user has checked “Use Random Message?”, show a select for picking the set
    if (data.useRandomMessage) {
      const allSets = this.randomMessageStore?.messages || [];
      elements.push(
        <Form.Item label="Random Message Set" key="randomMessageId">
          <Select
            style={{ width: '100%' }}
            placeholder="Pick a random-message set"
            value={data.randomMessageId}
            onChange={(val) => {
              // If your handleValueChange expects (field, event), do:
              const e = { target: { value: val } };
              this.handleValueChange('randomMessageId', e);
            }}
          >
            {allSets.map(rm => (
              <Select.Option key={rm._id} value={rm._id}>
                {rm.title}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      );
    }

    // “Use a Reply Tweet?” checkbox
    elements.push(
      <Form.Item key="useReplyTweet">
        <Checkbox
          checked={!!data.useReplyTweet}
          onChange={this.handleCheckedChange.bind(this, 'useReplyTweet')}
        >
          Post a follow-up reply tweet?
        </Checkbox>
      </Form.Item>
    );

    // If user wants a reply tweet, show a text input for the reply message
    if (data.useReplyTweet) {
      elements.push(
        <Form.Item label="Reply Tweet Text" key="replyMessage">
          <Input.TextArea
            rows={3}
            placeholder="Your follow-up tweet text here"
            value={data.replyMessage || ''}
            onChange={this.handleValueChange.bind(this, 'replyMessage')}
          />
        </Form.Item>
      );
    }

    return elements;
  }


  renderRightForm(data: TwitterFileOptions) {
    const elements = super.renderRightForm(data);
    return elements;
  }
}
