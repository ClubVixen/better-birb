import React, { useState } from 'react';
import SubmissionService from '../../../services/submission.service';
import SubmissionUtil from '../../../utils/submission.util';
import _ from 'lodash';
import { Link } from 'react-router-dom';
import { SubmissionPackage, SubmissionRating } from 'postybirb-commons';
import moment from 'moment';
import SubmissionSelectModal from '../submission-select/SubmissionSelectModal';
import { SubmissionType } from 'postybirb-commons';
import { Submission } from 'postybirb-commons';
import PostService from '../../../services/post.service';
import { submissionStore } from '../../../stores/submission.store';
import { Button,Modal, DatePicker, Input, List, message, Form, InputNumber } from 'antd';
import { EditableSubmissionListItem } from './EditableSubmissionListItem';
import { DragDropContext, Droppable, DropResult } from 'react-beautiful-dnd';
import { NotificationSubmissionCreator } from './NotificationSubmissionCreator';
import { FileSubmissionCreator } from './FileSubmissionCreator';
import { Checkbox, Select,Radio } from 'antd';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';
import fs from 'fs'
import { getAutoTagsNoUI } from '../../../services/AiTaggerService';
interface Props {
  submissions: SubmissionPackage<any>[];
  isLoading: boolean;
  type: SubmissionType;
  
}
interface ExtendedSubmissionPackage extends SubmissionPackage<any> { // Use this interface
  scheduleDate?: string | Date;
  newDate?: string;
}
interface AutoTagEdit {
  tags: string[];
  rating: string;
}
interface State {
  search: string;
  deleteModalVisible: boolean;
  postModalVisible: boolean;
  scheduleManyModalVisible: boolean;
  enableCascade: boolean;
  applyCascadeToAllSites: boolean;
  ignoreSites: string[];
  affectedSubmissions: ExtendedSubmissionPackage[];
  autoTagSelectModalVisible: boolean;
  autoTagProgress: { current: number; total: number } | null;
  affectedImages: Array<{
    title: string;
    originalDate: string;
    newDate: string;
  }>;
  showAffectedImagesModal: boolean;
  scheduleManyPeriod: {
    d: number;
    h: number;
    m: number;
    time: moment.Moment;
  };
  enableAutoTagging: boolean;
  autoTaggingResults: {
    [submissionId: string]: {
      tags: string[];
      rating: string;
    };
  };

  showAutoTagModal?: boolean;
  autoTaggingEdits?: {
    [submissionId: string]: AutoTagEdit;
  };
}
const ratingMap = {
  'Safe': SubmissionRating.GENERAL,
  'Suggestive': SubmissionRating.MATURE,
  'Explicit': SubmissionRating.ADULT
};

export class EditableSubmissions extends React.Component<Props, State> {
  state: State = {
    search: '',
    deleteModalVisible: false,
    postModalVisible: false,
    scheduleManyModalVisible: false,
    enableCascade: false,
    applyCascadeToAllSites: false,
    ignoreSites: [],
    affectedSubmissions: [],
    affectedImages: [],
    autoTagProgress: null,
    showAffectedImagesModal: false,
    autoTagSelectModalVisible: false,
    scheduleManyPeriod: {
      d: 0,
      h: 0,
      m: 1,
      time: moment(),
    },
    enableAutoTagging: false,
  autoTaggingResults: {},
  };
  

  handleSearch = ({ target }) => this.setState({ search: target.value.toLowerCase() });
  handleIgnoreSitesChange(selectedSites: string[]) {
    this.setState({ ignoreSites: selectedSites });
  }
  
  deleteSubmissions(submissions: SubmissionPackage<any>[]) {
    this.setState({ deleteModalVisible: false });
    Promise.all(
      submissions.map(s => SubmissionService.deleteSubmission(s.submission._id))
    ).finally(() => message.success('Submissions deleted.'));
  }

  async postSubmissions(submissions: SubmissionPackage<any>[]) {
    this.setState({ postModalVisible: false });
    for (let i = 0; i < submissions.length; i++) {
      try {
        await PostService.queue(submissions[i].submission._id);
      } catch {
        message.error(`Unable to queue ${SubmissionUtil.getSubmissionTitle(submissions[i])}.`);
      }
    }

    message.success('Submissions queued.');
  }
// Function to handle cascading schedule
async cascadeReschedule(date: moment.Moment, platform: string) {
  let rescheduleDate = moment(date).add(
    this.state.scheduleManyPeriod.d,
    'days'
  );
  rescheduleDate.add(this.state.scheduleManyPeriod.h, 'hours');
  rescheduleDate.add(this.state.scheduleManyPeriod.m, 'minutes');

  const platformSubmissions = this.props.submissions.filter(
    s =>
      s.submission.platform === platform &&
      moment(s.submission.scheduledDate).isSameOrAfter(date)
  );

  // Sort submissions by date
  platformSubmissions.sort((a, b) =>
    moment(a.submission.scheduledDate).diff(b.submission.scheduledDate)
  );

  for (let submission of platformSubmissions) {
    await SubmissionService.schedule(
      submission.submission._id,
      true,
      rescheduleDate.valueOf()
    );
    rescheduleDate.add(this.state.scheduleManyPeriod.d, 'days');
    rescheduleDate.add(this.state.scheduleManyPeriod.h, 'hours');
    rescheduleDate.add(this.state.scheduleManyPeriod.m, 'minutes');
  }
}

//AUTO TAGGING
// --------------------------------------------------------------------------
// 1) Helper to gather only "affected" file submissions
// --------------------------------------------------------------------------
private generateAffectedFileSubmissions(
  submissions: SubmissionPackage<any>[]
): ExtendedSubmissionPackage[] {
  console.log(
    '[Debug] generateAffectedFileSubmissions called with submissions:',
    submissions.length
  );

  let fileSubs = submissions.filter((submission) => {
    console.log(
      '[Debug] Checking sub ID:',
      submission.submission._id,
      'type:',
      submission.submission.type,
      'primary?:',
      (submission.submission as any).primary,
      'posted:',
      submission.submission.posted
    );
  
    // 1) Must be FILE type
    if (submission.submission.type !== SubmissionType.FILE) {
      console.log('[Debug] Excluding because type is not FILE');
      return false;
    }
  
   // Must have a .primary.location
   const primary = (submission.submission as any).primary;
   if (!primary?.location) {
     console.log('[Debug] Excluding because no .primary.location');
     return false;
   }
  
    // 3) Skip if posted
    if (submission.submission.posted) {
      console.log('[Debug] Excluding because posted =', submission.submission.posted);
      return false;
    }
  
    console.log('[Debug] => PASSED filters, found location:', primary.location);
    return true;
  });
  
  // Sort them
  fileSubs = fileSubs.sort((a, b) =>
    moment(a.submission.schedule.postAt).diff(moment(b.submission.schedule.postAt))
  );

  // Extend them if desired
  const extended = fileSubs.map((sub) => {
    return {
      ...sub
    } as ExtendedSubmissionPackage;
  });

  console.log('[Debug] generateAffectedFileSubmissions returned:', extended.length, 'items');
  extended.forEach((s) =>
    console.log(
      '[Debug] Sub ID:',
      s.submission._id,
      'title:',
      s.submission.title,
      'location:',
      (s.submission as any).primary?.location
    )
  );

  return extended;
}
/*


// --------------------------------------------------------------------------
// 3) handleAutoTagging: main flow
// --------------------------------------------------------------------------
async handleAutoTagging() {
  // Filter by search first
  const searchedSubs = this.props.submissions.filter((s) =>
    SubmissionUtil.getSubmissionTitle(s).toLowerCase().includes(this.state.search)
  );

  console.log('[Debug] handleAutoTagging - after search filter:', searchedSubs.length, 'submissions');

  // Gather affected file submissions
  const fileSubs = this.generateAffectedFileSubmissions(
    searchedSubs,
    
  );

  console.log('[Debug] handleAutoTagging - fileSubs to auto-tag:', fileSubs.length);
*/

// --------------------------------------------------------------------------
// 2) getAutoTags: calls the spawn-based getAutoTagsNoUI
// --------------------------------------------------------------------------
getAutoTags = async (imagePath: string) => {
  console.log('[Debug] getAutoTags called with:', imagePath);
  const result = await getAutoTagsNoUI(imagePath);
  console.log('[Debug] getAutoTags result for', imagePath, ':', result);
  return result; // { tags: string[], rating: string }
};

async handleAutoTagSubmissions(submissions: SubmissionPackage<any>[]) {
  // 1) Hide the modal
  this.setState({ autoTagSelectModalVisible: false });

  // 2) Filter those submissions if needed 
  // (like your generateAffectedFileSubmissions if you want to skip posted or no .primary)
  const fileSubs = this.generateAffectedFileSubmissions(submissions);
  //Initialize progress
  this.setState({ 
    autoTagProgress: { current: 0, total: fileSubs.length } 
  });

  
  const autoTaggingResults = { ...this.state.autoTaggingResults };

   // 3) Loop, calling auto-tag for each image
   for (let i = 0; i < fileSubs.length; i++) {
    const submission = fileSubs[i];
    const primary = (submission.submission as any).primary;
    const imagePath = primary.location;

    try {
      const result = await this.getAutoTags(imagePath);
      autoTaggingResults[submission.submission._id] = {
        tags: result.tags,
        rating: result.rating
      };
    } catch (error) {
      console.error('Error auto-tagging submission', error);
    }

    // 4) Increment progress
    this.setState((prev) => {
      if (!prev.autoTagProgress) return null;
      const { current, total } = prev.autoTagProgress;
      return {
        autoTagProgress: {
          current: current + 1,
          total
        }
      } as Pick<State, 'autoTagProgress'>; 
    });    
  }
 // Once done, remove progress & show modal
 this.setState({ autoTagProgress: null });

  // Build edits and show modal
  const autoTaggingEdits: { [id: string]: AutoTagEdit } = {};
  for (const id in autoTaggingResults) {
    autoTaggingEdits[id] = {
      tags: [...autoTaggingResults[id].tags],
      rating: autoTaggingResults[id].rating,
    };
  }

 // console.log('[Debug] Final autoTaggingEdits created for:', Object.keys(autoTaggingEdits));

  this.setState({
    autoTaggingResults,
    showAutoTagModal: true,
    autoTaggingEdits,
  });
}

handleTagCheckboxChange = (submissionId: string, tag: string, checked: boolean) => {
  this.setState(prev => {
    const current = prev.autoTaggingEdits![submissionId];
    const newTags = checked
      ? [...current.tags, tag]
      : current.tags.filter(t => t !== tag);
    return {
      autoTaggingEdits: {
        ...prev.autoTaggingEdits!,
        [submissionId]: { ...current, tags: newTags }
      }
    };
  });
}

handleRatingChange = (submissionId: string, rating: string) => {
  this.setState(prev => ({
    autoTaggingEdits: {
      ...prev.autoTaggingEdits!,
      [submissionId]: { ...prev.autoTaggingEdits![submissionId], rating }
    }
  }));
}

async finalizeAutoTagEdits() {
  const { autoTaggingEdits } = this.state;
  if (!autoTaggingEdits) return;

  const submissions = this.props.submissions;
  for (const s of submissions) {
    const edit = autoTaggingEdits[s.submission._id];
    if (!edit) continue;

    // 1) Convert s.parts object to array of [key, part]
    const partsEntries = Object.entries(s.parts);

    // 2) Map over array to update default parts
    const updatedEntries = partsEntries.map(([key, part]) => {
      if (part.isDefault) {
        const updatedData = {
          ...part.data,
          tags: {
            extendDefault: false,
            value: edit.tags
          },
          rating: ratingMap[edit.rating] || SubmissionRating.GENERAL
        };
        return [key, { ...part, data: updatedData }] as const;
      }
      return [key, part] as const;
    });

    // 3) Convert back to Record<string, SubmissionPart<any>>
    const updatedParts = Object.fromEntries(updatedEntries);
    const updatedPartsArray = Object.values(updatedParts);
    const update = {
      id: s.submission._id,
      parts: updatedPartsArray,
      removedParts: [],
      altTexts: {}
    };

    try {
      await SubmissionService.updateSubmission(update);
    } catch (e) {
      console.error(`Failed to update submission ${s.submission._id}`, e);
      message.error(`Failed to update ${SubmissionUtil.getSubmissionTitle(s)}`);
    }
  }

  message.success('All selected submissions updated with new tags and ratings.');
  this.setState({
    showAutoTagModal: false,
    autoTaggingEdits: undefined
  });
}


renderAutoTagModal() {
  const { showAutoTagModal, autoTaggingEdits, autoTaggingResults } = this.state;
  if (!showAutoTagModal || !autoTaggingEdits || !autoTaggingResults) return null;

  // Determine which submissions are “tagged” (i.e. found in autoTaggingResults)
  const taggedSubmissions = this.props.submissions.filter(
    (s) => autoTaggingResults[s.submission._id]
  );

  console.log('[Debug] renderAutoTagModal - taggedSubmissions:', taggedSubmissions.length);
  taggedSubmissions.forEach((sub) => {
    console.log(
      ' -> Sub ID:',
      sub.submission._id,
      'title:',
      sub.submission.title,
      'tags:',
      autoTaggingResults[sub.submission._id].tags
    );
  });

  return (
    <Modal
      title="Auto-Tagging Results"
      visible={showAutoTagModal}
      width={800}
      onCancel={() => this.setState({ showAutoTagModal: false })}
      onOk={this.finalizeAutoTagEdits.bind(this)}
    >
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <List
          dataSource={taggedSubmissions}
          renderItem={submission => {
            const edit = autoTaggingEdits[submission.submission._id];
            if (!edit) return null;

            let previewUrl = '';
            if (submission.submission.type === SubmissionType.FILE) {
              const fileSub = submission.submission as any;
              previewUrl = fileSub.primary?.preview || '';
            }

            return (
              <List.Item key={submission.submission._id}>
                <List.Item.Meta
                  avatar={
                    previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={submission.submission.title}
                        style={{ maxWidth: '250px', height: 'auto'  }}
                      />
                    ) : null
                  }
                  title={SubmissionUtil.getSubmissionTitle(submission)}
                  description={
                    <>
                      <div>
                        <strong>Tags:</strong>
                        <div>
                          {autoTaggingResults[submission.submission._id].tags.map(tag => (
                            <Checkbox
                              key={tag}
                              checked={edit.tags.includes(tag)}
                              onChange={e =>
                                this.handleTagCheckboxChange(submission.submission._id, tag, e.target.checked)
                              }
                            >
                              {tag}
                            </Checkbox>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginTop: '10px' }}>
                        <strong>Rating:</strong>
                        <Radio.Group
                          value={edit.rating}
                          onChange={e => this.handleRatingChange(submission.submission._id, e.target.value)}
                        >
                          <Radio value="Safe">Safe</Radio>
                          <Radio value="Suggestive">Suggestive</Radio>
                          <Radio value="Explicit">Explicit</Radio>
                        </Radio.Group>
                      </div>
                    </>
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>
    </Modal>
  );
}








//SCHEDULE RE DONE
async scheduleSubmissions(submissions: SubmissionPackage<any>[]) {
  const { ignoreSites, applyCascadeToAllSites, enableCascade } = this.state;

  const allScheduledSubmissions = await SubmissionService.getScheduledSubmissions();

  const filteredSubmissions = submissions.filter(submission => {
    const websites = Object.values(submission.parts || {}).map(part => part.website);
    if (applyCascadeToAllSites) return true;
    return !websites.some(site => ignoreSites.includes(site));
  });

  if (enableCascade) {
    this.generateAffectedSubmissionsList(
      [...allScheduledSubmissions, ...filteredSubmissions],
      moment(this.state.scheduleManyPeriod.time)
    );
    this.setState({ showAffectedImagesModal: true });
    return;
  }

  this.confirmScheduleSubmissions(filteredSubmissions);
}

generateAffectedSubmissionsList(submissions: SubmissionPackage<any>[], startAt: moment.Moment) {
  const { ignoreSites, applyCascadeToAllSites } = this.state;

  const affectedSubmissions = submissions
    .filter(submission => {
      const websites = Object.values(submission.parts || {}).map(part => part.website);
      const isAfterStart = moment(submission.submission.schedule.postAt).isSameOrAfter(startAt);
      if (applyCascadeToAllSites) return isAfterStart && !submission.submission.posted;
      return isAfterStart && !websites.some(site => ignoreSites.includes(site)) && !submission.submission.posted;
    })
    .sort((a, b) => moment(a.submission.schedule.postAt).diff(moment(b.submission.schedule.postAt)))
    .map(submission => ({
      ...submission,
      newDate: moment(submission.submission.schedule.postAt)
        .add(this.state.scheduleManyPeriod.d, 'days')
        .add(this.state.scheduleManyPeriod.h, 'hours')
        .add(this.state.scheduleManyPeriod.m, 'minutes')
        .format('YYYY-MM-DD HH:mm:ss'),
    } as ExtendedSubmissionPackage));

  this.setState({ affectedSubmissions, showAffectedImagesModal: true });
}



confirmScheduleSubmissions(submissions: ExtendedSubmissionPackage[]) {
  Promise.all(
    submissions.map(submission => {
      // Use the newDate if it exists, otherwise fall back to the original date
      const scheduledDate = submission.newDate
        ? moment(submission.newDate, 'YYYY-MM-DD HH:mm:ss').valueOf()
        : moment(submission.submission.schedule.postAt).valueOf();

      console.log(
        `Scheduling ${submission.submission.title} at ${moment(scheduledDate).format('YYYY-MM-DD HH:mm:ss')}`
      );

      // Schedule the submission
      return SubmissionService.schedule(submission.submission._id, true, scheduledDate);
    })
  )
    .then(() => {
      message.success('Submissions scheduled successfully.');
    })
    .finally(() => {
      // Close the modal and reset the state
      this.setState({
        showAffectedImagesModal: false,
        affectedSubmissions: [],
        scheduleManyModalVisible: false,
      });
    });
}





generateAffectedImagesList(
  submissions: SubmissionPackage<any>[],
  startAt: moment.Moment
) {
  const { ignoreSites, applyCascadeToAllSites } = this.state;

  console.log("Starting date for cascading:", startAt.format('YYYY-MM-DD HH:mm:ss'));

  // Sort submissions by original schedule date
  const sortedSubmissions = submissions
    .filter(submission => {
      const websites = Object.values(submission.parts || {}).map(part => part.website);
      if (applyCascadeToAllSites) return true;
      return !websites.some(site => ignoreSites.includes(site));
    })
    .sort((a, b) => moment(a.submission.schedule.postAt).diff(moment(b.submission.schedule.postAt)));

  const affectedImages = sortedSubmissions.map(submission => {
    const originalDate = moment(submission.submission.schedule.postAt).format('YYYY-MM-DD HH:mm:ss');
    const newDate = moment(submission.submission.schedule.postAt)
      .add(this.state.scheduleManyPeriod.d, 'days')
      .add(this.state.scheduleManyPeriod.h, 'hours')
      .add(this.state.scheduleManyPeriod.m, 'minutes')
      .format('YYYY-MM-DD HH:mm:ss');

    console.log(
      `Calculating new date for submission: ${submission.submission.title}`,
      `Original Date: ${originalDate}, New Date: ${newDate}`
    );

    return {
      title: SubmissionUtil.getSubmissionTitle(submission),
      originalDate,
      newDate: newDate, 
    };
  });

  console.log("Affected Images List:", affectedImages);
  this.setState({ affectedImages, showAffectedImagesModal: true });
}






// Toggle cascade option
toggleCascade = () => {
  this.setState({ enableCascade: !this.state.enableCascade });
};
  onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) {
      return;
    }

    if (source.droppableId !== destination.droppableId) {
      return;
    }

    if (source.index === destination.index) {
      return;
    }

    submissionStore.changeOrder(result.draggableId, source.index, destination.index);
  }

  
  render() {
    const submissions = this.props.submissions.filter(s =>
      SubmissionUtil.getSubmissionTitle(s).toLowerCase().includes(this.state.search)
    );
  
    const sites = ["Patreon", "Derpibooru", "Twitter", "DeviantArt"];
    const { autoTaggingEdits } = this.state;
    const { autoTagProgress } = this.state;
    return (
      
      <>
     {/* Checkbox for enabling Auto-Tagging 
       <Checkbox
          checked={this.state.enableAutoTagging}
          onChange={(e) => {
            this.setState({ enableAutoTagging: e.target.checked }, () => {
              if (e.target.checked) {
                this.handleAutoTagging();
              }
            });
          }}
        >
          Enable Auto-Tagging
        </Checkbox> 
*/}
        {/* Checkbox for enabling Cascade */}
        <Checkbox
          checked={this.state.enableCascade}
          onChange={(e) => this.setState({ enableCascade: e.target.checked })}
        >
          Enable Cascade
        </Checkbox>
        {this.state.enableCascade && (
          <>
            {/* Checkbox for applying cascade to all sites */}
            <Checkbox
              checked={this.state.applyCascadeToAllSites}
              onChange={(e) => this.setState({ applyCascadeToAllSites: e.target.checked })}
            >
              Apply Cascade to All Sites
            </Checkbox>
  
            {/* Select box for ignoring specific sites */}
            {!this.state.applyCascadeToAllSites && (
              <Select<string[]>
              mode="multiple"
              placeholder="Select sites to ignore"
              style={{ width: '100%', marginTop: '10px' }}
              onChange={(selectedSites) => this.setState({ ignoreSites: selectedSites })}
            >
              {sites.map(site => (
                <Select.Option key={site} value={site}>
                  {site}
                </Select.Option>
              ))}
            </Select>            
            )}
          </>
        )}
  
        {/* File/Notification Submission Creator */}
        <div className="uploader mb-2">
          {this.props.type === SubmissionType.FILE ? (
            <FileSubmissionCreator />
          ) : (
            <NotificationSubmissionCreator />
          )}
        </div>
        
        <div>
          <DragDropContext onDragEnd={this.onDragEnd.bind(this)}>
            <Droppable droppableId="submissions">
              {provided => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  <List
                    footer={this.props.children}
                    itemLayout="vertical"
                    loading={this.props.isLoading}
                    dataSource={submissions}
                    renderItem={(item: SubmissionPackage<Submission>) => {
                      let autoTaggingResult;
                      if (autoTaggingEdits && autoTaggingEdits[item.submission._id]) {
                        autoTaggingResult = autoTaggingEdits[item.submission._id];
                      }
                      return (
                        <EditableSubmissionListItem
                          item={item}
                          totalItems={submissions.length}
                          autoTaggingResult={autoTaggingResult}
                          onTagChange={this.handleTagCheckboxChange}
                          onRatingChange={this.handleRatingChange}
                        />
                      );
                    }}

                  header={
                    <div className="flex">
                      <div style={{ flex: 10 }}>
                        <Input.Search onChange={this.handleSearch} style={{ width: 200 }} />
                      </div>
                      <div className="text-right">
                        <Link
                          className={submissions.length ? 'pointer-none' : ''}
                          to={`/edit/multiple-submissions/${_.get(
                            submissions,
                            '[0].submission.type',
                            SubmissionType.FILE
                          )}`}
                        >
                          

                            <Button type="default" disabled={!submissions.length} className="mr-1">
                              Edit Many
                            </Button>
                          </Link>
                          <Button
                              type="primary"
                              className="mr-1"
                              onClick={() => {
                                console.log('Auto-Tag Many button clicked');
                                // Show a new modal state
                                this.setState({ autoTagSelectModalVisible: true });
                              }}
                              disabled={!submissions.length}
                            >
                              Auto-Tag Many
                            </Button>

                          <Button
                            className="mr-1"
                            type="danger"
                            onClick={() => {
                              console.log('Delete Many button clicked');
                              this.setState({ deleteModalVisible: true });
                            }}
                            disabled={!submissions.length}
                          >
                            Delete Many
                          </Button>
                          <Button
                            type="primary"
                            className="mr-1"
                            onClick={() => {
                              console.log('Schedule Many button clicked');
                              this.setState({ scheduleManyModalVisible: true });
                            }}
                            disabled={!submissions.length}
                          >
                            Schedule Many
                          </Button>

                          <Button
                            type="primary"
                            onClick={() => this.setState({ postModalVisible: true })}
                            disabled={!submissions.length}
                          >
                            Post Many
                          </Button>
                        </div>
                        <SubmissionSelectModal
                          visible={this.state.deleteModalVisible}
                          title="Delete"
                          multiple={true}
                          selectAll={true}
                          submissionType={_.get(
                            this.props.submissions[0],
                            'submission.type',
                            SubmissionType.FILE
                          )}
                          onClose={() => this.setState({ deleteModalVisible: false })}
                          onOk={this.deleteSubmissions.bind(this)}
                          ignorePosting={true}
                          ignoreScheduled={true}
                        />
                        <SubmissionSelectModal
                          visible={this.state.autoTagSelectModalVisible}
                          validOnly={true}
                          title="Auto-Tag"
                          multiple={true}
                          selectAll={true}
                          submissionType={_.get(
                            this.props.submissions[0],
                            'submission.type',
                            SubmissionType.FILE
                          )}
                          // When user closes without selecting
                          onClose={() => this.setState({ autoTagSelectModalVisible: false })}
                          // When user confirms selection
                          onOk={this.handleAutoTagSubmissions.bind(this)}
                          ignorePosting={true}
                          ignoreScheduled={true}
                        >
                          <p>Select which submissions you want to auto-tag.</p>
                        </SubmissionSelectModal>




                        <SubmissionSelectModal
                          visible={this.state.postModalVisible}
                          validOnly={true}
                          title="Post"
                          multiple={true}
                          selectAll={true}
                          submissionType={_.get(
                            this.props.submissions[0],
                            'submission.type',
                            SubmissionType.FILE
                          )}
                          onClose={() => this.setState({ postModalVisible: false })}
                          onOk={this.postSubmissions.bind(this)}
                          ignorePosting={true}
                          ignoreScheduled={true}
                        >
                          <p>Submissions that have a schedule time will be scheduled instead</p>
                        </SubmissionSelectModal>

                        {autoTagProgress && (
                          <p>Auto-Tagging {autoTagProgress.current} / {autoTagProgress.total}</p>
                        )}

                        <Modal // Dedicated Modal for Cascading Reschedule *inside* EditableSubmissions
                          title="Affected Submissions"
                          visible={this.state.showAffectedImagesModal}
                          onCancel={() => this.setState({ showAffectedImagesModal: false })}
                          onOk={() => this.confirmScheduleSubmissions(this.state.affectedSubmissions)}
                          footer={[
                            <Button key="back" onClick={() => this.setState({ showAffectedImagesModal: false })}>
                              Cancel
                            </Button>,
                            <Button
                              key="submit"
                              type="primary"
                              onClick={() => this.confirmScheduleSubmissions(this.state.affectedSubmissions)}
                            >
                              Confirm Schedule
                            </Button>,
                          ]}
                      >
                        <List
                          dataSource={this.state.affectedSubmissions}
                          renderItem={(submission: ExtendedSubmissionPackage) => (
                            <List.Item>
                              <div><b>Title:</b> {SubmissionUtil.getSubmissionTitle(submission)}</div>
                              <div><b>Original Date:</b> {moment(submission.submission.schedule.postAt).format('YYYY-MM-DD HH:mm:ss')}</div>
                              <div><b>New Date:</b> {submission.newDate}</div>
                            </List.Item>
                          )}
                        />
                      </Modal>

                      <SubmissionSelectModal
                      visible={this.state.scheduleManyModalVisible}
                      validOnly={true}
                      title="Schedule"
                      multiple={true}
                      selectAll={true}
                      submissionType={_.get(
                        this.props.submissions[0],
                        'submission.type',
                        SubmissionType.FILE
                      )}
                      ignorePosting={true}
                      ignoreScheduled={true}
                      onClose={() => this.setState({ scheduleManyModalVisible: false })}
                      onOk={this.scheduleSubmissions.bind(this)}
                      below={
                        <Form layout="vertical">
                          <Form.Item label="Starting At" required>
                            <DatePicker
                              className="w-full"
                              value={this.state.scheduleManyPeriod.time}
                              format="YYYY-MM-DD HH:mm:ss"
                              showTime={{ format: 'HH:mm:ss', use12Hours: true }}
                              onChange={value =>
                                this.setState(prevState => ({
                                  scheduleManyPeriod: {
                                    ...prevState.scheduleManyPeriod,
                                    time: value ? value : moment()
                                  }
                                }))
                              }
                            />
                          </Form.Item>
                          <Form.Item label="Time Between">
                            <Form.Item label="Days">
                              <InputNumber
                                value={this.state.scheduleManyPeriod.d}
                                min={0}
                                onChange={value =>
                                  this.setState(prevState => ({
                                    scheduleManyPeriod: {
                                      ...prevState.scheduleManyPeriod,
                                      d: value || 0
                                    }
                                  }))
                                }
                                precision={0}
                              />
                            </Form.Item>
                            <Form.Item label="Hours">
                              <InputNumber
                                value={this.state.scheduleManyPeriod.h}
                                min={0}
                                onChange={value =>
                                  this.setState(prevState => ({
                                    scheduleManyPeriod: {
                                      ...prevState.scheduleManyPeriod,
                                      h: value || 0
                                    }
                                  }))
                                }
                                precision={0}
                              />
                            </Form.Item>
                            <Form.Item label="Minutes">
                              <InputNumber
                                value={this.state.scheduleManyPeriod.m}
                                min={0}
                                onChange={value =>
                                  this.setState(prevState => ({
                                    scheduleManyPeriod: {
                                      ...prevState.scheduleManyPeriod,
                                      m: value || 0
                                    }
                                  }))
                                }
                                precision={0}
                              />
                            </Form.Item>
                          </Form.Item>
                        </Form>
                      }
                    />
                    
                      </div>
                    }
                  />
                  {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
      {this.renderAutoTagModal()}
      </>
  );
  }
}