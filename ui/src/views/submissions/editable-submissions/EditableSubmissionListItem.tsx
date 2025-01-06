import {
  Alert,
  Avatar,
  DatePicker,
  Icon,
  List,
  message,
  Modal,
  Popconfirm,
  Typography,
  Checkbox,
  Radio,
  Button
} from 'antd';
import moment from 'moment';
//import React from 'react';
import { Draggable, DraggableProvided } from 'react-beautiful-dnd';
import { Link } from 'react-router-dom';
import { FileSubmission } from 'postybirb-commons';
import { SubmissionPackage } from 'postybirb-commons';
import { Submission } from 'postybirb-commons';
import { Problems } from 'postybirb-commons';
import PostService from '../../../services/post.service';
import SubmissionService from '../../../services/submission.service';
import { SubmissionType } from 'postybirb-commons';
import SubmissionUtil from '../../../utils/submission.util';
import { WebsiteRegistry } from '../../../websites/website-registry';
import { IssueState } from './IssueState';
import { scrollSubmissionStore } from '../../../stores/scroll-submission.store';
import { submissionStore } from '../../../stores/submission.store';
import React from 'react';

interface MyFileInfo {
  previewPath?: string;
  fullPath?: string;
  // anything else
}
interface MyFileSubmission extends FileSubmission {
  fileInfo?: MyFileInfo;
}
interface ListItemProps {
  item: SubmissionPackage<Submission>;
  totalItems: number;
  autoTaggingResult?: {
    tags: string[];
    rating: string;
  };
  
  // Callbacks to parent to update tags and rating
  onTagChange?: (submissionId: string, tag: string, checked: boolean) => void;
  onRatingChange?: (submissionId: string, rating: string) => void;
}
interface ListItemState {
  previewVisible: boolean;
  showScheduler: boolean;
  disableActions: boolean;
}
export class EditableSubmissionListItem extends React.Component<ListItemProps, ListItemState> {
  disableActions: boolean = false;
  postAt: number | undefined = undefined;

  constructor(props: ListItemProps) {
    super(props);
    this.state = {
      previewVisible: false,
      showScheduler: false,
      disableActions: false,
    };
  }

  hidePreview() {
    this.setState({ previewVisible: false });
  }

  showPreview() {
    this.setState({ previewVisible: true });
  }

  showScheduler() {
    this.setState({ showScheduler: true });
  }

  hideScheduler() {
    this.postAt = undefined;
    this.setState({ showScheduler: false });
  }

  handleScheduleUpdate() {
    if (this.disableActions) return;
    this.disableActions = true;
    this.setState({ disableActions: true });
    SubmissionService.setPostAt(this.props.item.submission._id, this.postAt).finally(() => {
      this.setState({ disableActions: false });
      this.disableActions = false;
    });
    this.hideScheduler();
  }

  onDuplicate() {
    if (this.disableActions) return;
    this.disableActions = true;
    this.setState({ disableActions: true });
    SubmissionService.duplicate(this.props.item.submission._id)
      .then(() => {
        message.success('Submission duplicated.');
      })
      .catch(() => {
        message.error('Failed to duplicate submission.');
      })
      .finally(() => {
        this.setState({ disableActions: false });
        this.disableActions = false;
      });
  }

  onPost() {
    if (this.disableActions) return;
    this.disableActions = true;
    this.setState({ disableActions: true });
    PostService.queue(this.props.item.submission._id)
      .then(() => {
        message.success('Submission queued.');
      })
      .catch(() => {
        message.error('Failed to queue submission.');
      })
      .finally(() => {
        this.setState({ disableActions: false });
        this.disableActions = false;
      });
  }

  onSchedule() {
    if (this.disableActions) return;
    this.disableActions = true;
    this.setState({ disableActions: true });
    SubmissionService.schedule(this.props.item.submission._id, true)
      .then(() => {
        message.success('Submission scheduled.');
      })
      .catch(() => {
        message.error('Failed to schedule submission.');
      })
      .finally(() => {
        this.setState({ disableActions: false });
        this.disableActions = false;
      });
  }

  splitAdditionalFilesIntoNewSubmissions() {
    SubmissionService.splitAdditionalFilesIntoNewSubmissions(this.props.item.submission._id)
      .then(() => {
        message.success('Submission successfully split.');
      })
      .catch(() => {
        message.error('Failed to split submission.');
      });
  }

  moveItem(currentIndex, offset) {
    const newIndex = currentIndex + offset;
    if (newIndex >= 0 && newIndex < this.props.totalItems) {
      submissionStore.changeOrder(this.props.item.submission._id, currentIndex, newIndex);
      this.forceUpdate(); // To ensure re-render
    }
  }

  unsupportedAdditionalWebsites() {
    const { item } = this.props;
    if ((item.submission as FileSubmission).additional!.length) {
      const unsupportedWebsites = Object.values(item.parts)
        .filter(p => !p.isDefault)
        .filter(p => p.postStatus !== 'SUCCESS')
        .filter(p => !WebsiteRegistry.websites[p.website].supportsAdditionalFiles)
        .map(p => WebsiteRegistry.websites[p.website].name);
      if (unsupportedWebsites.length) {
        return (
          <Alert
            type="error"
            message=""
            description={
              <div>
                <div>
                  The following website(s) do not support additional files:{' '}
                  {unsupportedWebsites.join(', ')}
                </div>

                <span
                  className="text-link"
                  onClick={this.splitAdditionalFilesIntoNewSubmissions.bind(this)}
                >
                  Create submissions for unsupported websites
                </span>
              </div>
            }
          />
        );
      }
    }
    return null;
  }

  scrollTo = (elem: HTMLElement | null): void => {
    if (scrollSubmissionStore.check(this.props.item.submission._id) && elem) {
      elem.scrollIntoView();
    }
  };

  render() {
    const { item, autoTaggingResult, onTagChange, onRatingChange } = this.props;
    const problems: Problems = item.problems;
    const problemCount: number = SubmissionUtil.getProblemCount(problems);
    const hasFailure = !!Object.values(item.parts).find(p => p.postStatus === 'FAILED');

    return (
      <Draggable
        key={item.submission._id}
        draggableId={item.submission._id}
        index={item.submission.order}
      >
        {(provided: DraggableProvided) => (
          <div
            className="ant-list-item ant-list-split"
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            ref={provided.innerRef}
          >
            <List.Item
              className={`p-0 ${hasFailure ? 'error' : ''}`}
              extra={
                item.submission.type === SubmissionType.FILE
                  ? this.unsupportedAdditionalWebsites()
                  : null
              }
              actions={[
                <span
                  className={`text-link ${problemCount > 0 || this.state.disableActions ? 'disabled' : ''}`}
                  key="submission-post"
                  onClick={this.onPost.bind(this)}
                >
                  Post
                </span>,
                <span
                  className={`text-link ${
                    problemCount > 0 ||
                    !item.submission.schedule.postAt ||
                    this.state.disableActions
                      ? 'disabled'
                      : ''
                  }`}
                  key="submission-schedule"
                  onClick={this.onSchedule.bind(this)}
                >
                  Schedule
                </span>,
                <Link
                  className={`${this.state.disableActions ? 'disabled' : ''}`}
                  to={`/edit/submission/${item.submission.type}/${item.submission._id}`}
                  key="submission-edit-link"
                >
                  <span key="submission-edit">Edit</span>
                </Link>,
                <span
                  className={`text-link ${this.state.disableActions ? 'disabled' : ''}`}
                  key="submission-duplicate"
                  onClick={this.onDuplicate.bind(this)}
                >
                  Duplicate
                </span>,

                <span
                  className="text-link"
                  key="move-up-5"
                  onClick={() => this.moveItem(this.props.item.submission.order, -5)}
                >
                  Up 5
                </span>,
                <span
                  className="text-link"
                  key="move-down-5"
                  onClick={() => this.moveItem(this.props.item.submission.order, 5)}
                >
                  Down 5
                </span>,

                <span
                  className="text-link"
                  key="send-to-top"
                  onClick={() =>
                    this.moveItem(
                      this.props.item.submission.order,
                      -this.props.item.submission.order
                    )
                  }
                >
                  Send to Top
                </span>,
                <span
                  className="text-link"
                  key="send-to-bottom"
                  onClick={() =>
                    this.moveItem(
                      this.props.item.submission.order,
                      this.props.totalItems - this.props.item.submission.order - 1
                    )
                  }
                >
                  Send to Bottom
                </span>,

                <Popconfirm
                  disabled={this.state.disableActions}
                  cancelText="No"
                  okText="Yes"
                  title="Are you sure you want to delete? This action cannot be undone."
                  onConfirm={() => SubmissionService.deleteSubmission(item.submission._id)}
                  key="submission-delete"
                >
                  <Typography.Text
                    className={`${this.state.disableActions ? 'disabled' : ''}`}
                    type="danger"
                  >
                    Delete
                  </Typography.Text>
                </Popconfirm>,
                <IssueState problems={problems} problemCount={problemCount} key="issue-state" />
              ]}
            >
              <List.Item.Meta
                avatar={
                  <div ref={this.scrollTo}>
                    {item.submission.type === SubmissionType.FILE ? (
                      <div className="cursor-zoom-in" onClick={this.showPreview.bind(this)}>
                        <Avatar
                          src={(item.submission as FileSubmission).primary.preview}
                          shape="square"
                        />
                      </div>
                    ) : (
                      <Avatar icon="notification" shape="square" />
                    )}
                  </div>
                }
                title={
                  <span className={hasFailure ? 'text-danger' : ''}>{`${
                    hasFailure ? '[FAILED] ' : ''
                  }${SubmissionUtil.getSubmissionTitle(item)}`}</span>
                }
                description={
                  <div>
                    <span>
                      <Icon type="calendar" />
                    </span>
                    <span className="mx-1">
                      {item.submission.schedule.postAt
                        ? new Date(item.submission.schedule.postAt).toLocaleString()
                        : 'Unscheduled'}
                    </span>
                    <span className="text-link">
                      <Icon onClick={this.showScheduler.bind(this)} type="edit" />
                    </span>
                  </div>
                }
              ></List.Item.Meta>

              {/* If autoTaggingResult is present, display the suggested tags and rating UI */}
              {autoTaggingResult && (
                <div style={{ marginTop: '10px' }}>
                  {/* Image Preview */}
                  {item.submission.type === SubmissionType.FILE && (() => {
                    const fileSubmission = item.submission as MyFileSubmission;
                    if ('fileInfo' in fileSubmission && fileSubmission.fileInfo) {
                      return (
                        <img
                          src={fileSubmission.fileInfo.previewPath}
                          alt={item.submission.title}
                          style={{ maxWidth: '200px' }}
                        />
                      );
                    }
                  })()}

                  {/* Suggested Tags */}
                  <div>
                    <h4>Suggested Tags:</h4>
                    {autoTaggingResult.tags.map(tag => (
                      <Checkbox
                        key={tag}
                        // Instead of storing local state here, we rely on parent's data
                        // The parent will pass down whether this tag is selected
                        checked={this.props.autoTaggingResult?.tags.includes(tag)}
                        onChange={(e) => onTagChange && onTagChange(item.submission._id, tag, e.target.checked)}
                      >
                        {tag}
                      </Checkbox>
                    ))}
                  </div>

                  {/* Rating Options */}
                  <div style={{ marginTop: '10px' }}>
                    <h4>Rating:</h4>
                    <Radio.Group
                      value={this.props.autoTaggingResult?.rating ?? 'GENERAL'}
                      onChange={(e) => onRatingChange && onRatingChange(item.submission._id, e.target.value)}
                    >
                      <Radio value="GENERAL">GENERAL</Radio>
                      <Radio value="MATURE">MATURE</Radio>
                      <Radio value="ADULT">ADULT</Radio>
                    </Radio.Group>
                  </div>
                </div>
              )}

              {item.submission.type === SubmissionType.FILE ? (
                <Modal
                  visible={this.state.previewVisible}
                  footer={null}
                  onCancel={this.hidePreview.bind(this)}
                  destroyOnClose={true}
                >
                  <img
                    alt="preview"
                    className="w-full"
                    src={
                      (item.submission as FileSubmission).primary.type === 'IMAGE'
                        ? (item.submission as FileSubmission).primary.location
                        : (item.submission as FileSubmission).primary.preview
                    }
                  />
                </Modal>
              ) : null}

              <Modal
                title="Set Schedule"
                visible={this.state.showScheduler}
                onCancel={this.hideScheduler.bind(this)}
                onOk={this.handleScheduleUpdate.bind(this)}
                destroyOnClose={true}
              >
                <DatePicker
                  className="w-full"
                  defaultValue={
                    this.props.item.submission.schedule.postAt
                      ? moment(this.props.item.submission.schedule.postAt)
                      : undefined
                  }
                  format="YYYY-MM-DD HH:mm:ss"
                  showTime={{ format: 'HH:mm:ss', use12Hours: true }}
                  placeholder="Unscheduled"
                  onChange={value => (this.postAt = value ? value.valueOf() : undefined)}
                />
              </Modal>
            </List.Item>
            {provided.placeholder}
          </div>
        )}
      </Draggable>
    );
  }
}