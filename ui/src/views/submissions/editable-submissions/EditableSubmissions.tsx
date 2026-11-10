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
import { getAutoTagsNoUI } from '../../../services/AiTaggerService';
import { getImageTitle } from '../../../services/AiTaggerService';
import { Alert, Collapse, Tag } from 'antd';
import SettingsService from '../../../services/settings.service';



const { Panel } = Collapse;
interface Props {
  submissions: SubmissionPackage<any>[];
  isLoading: boolean;
  type: SubmissionType;
  
}
interface TagValidationData {
  [submissionId: string]: {
    [site: string]: {
      validTags: string[];
      discardedTags: Array<{
        tag: string;
        valid: boolean;
        usage: number;
        reason?: string;
      }>;
    };
  };
}

// FIX: Extend SubmissionPackage<Submission> instead of any
type ExtendedSubmissionPackage = SubmissionPackage<Submission> & { 
  scheduleDate?: string | Date;
  newDate?: string;
}
interface AutoTagEdit {
  tags: string[];
  rating: string;
  title: string;
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
  autoTitleSelectModalVisible: boolean;
  tagValidationData: TagValidationData;
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
      title: string;
    };
  };

  showAutoTagModal?: boolean;
  autoTaggingEdits?: {
    [submissionId: string]: AutoTagEdit;
  };
  settingsModalVisible?: boolean;
  titleGeneratorUrl?: string;
  qwenVlUrl?: string;
  qwenVlModel?: string;
  titleLlmUrl?: string;
  titleLlmModel?: string;
}
const ratingMap = {
  'Safe': SubmissionRating.GENERAL,
  'Suggestive': SubmissionRating.MATURE,
  'Explicit': SubmissionRating.ADULT
};

export class EditableSubmissions extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      search: '',
      deleteModalVisible: false,
      postModalVisible: false,
      scheduleManyModalVisible: false,
      enableCascade: false,
      applyCascadeToAllSites: false,
      ignoreSites: [],
      affectedSubmissions: [],
      affectedImages: [],
      tagValidationData: {},
      autoTagProgress: null,
      showAffectedImagesModal: false,
      autoTagSelectModalVisible: false,
      autoTitleSelectModalVisible: false,
      scheduleManyPeriod: {
        d: 0,
        h: 0,
        m: 1,
        time: moment(),
      },
      enableAutoTagging: false,
      autoTaggingResults: {},
      settingsModalVisible: false,
      titleGeneratorUrl: '',
      qwenVlUrl: 'http://127.0.0.1:8000/v1/chat/completions',
      qwenVlModel: 'Qwen2.5-VL-72B-Instruct-AWQ',
      titleLlmUrl: 'http://127.0.0.1:5000/v1/chat/completions',
      titleLlmModel: 'models--ReadyArt--Forgotten-Safeword-12B-v4.0',
    };
  }

  componentDidMount() {
    this.loadSettings();
  }
  
  loadSettings = () => {
    SettingsService.getSettings().then(({ data }) => {
      this.setState({
        titleGeneratorUrl: data.titleGeneratorUrl || '',
        qwenVlUrl: data.qwenVlUrl || 'http://127.0.0.1:8000/v1/chat/completions',
        qwenVlModel: data.qwenVlModel || 'Qwen2.5-VL-72B-Instruct-AWQ',
        titleLlmUrl: data.titleLlmUrl || 'http://127.0.0.1:5000/v1/chat/completions',
        titleLlmModel: data.titleLlmModel || 'models--ReadyArt--Forgotten-Safeword-12B-v4.0',
      });
    });
  };
  
  handleSaveSettings = () => {
    if (this.state.titleGeneratorUrl !== undefined) SettingsService.updateSetting('titleGeneratorUrl', this.state.titleGeneratorUrl);
    if (this.state.qwenVlUrl !== undefined) SettingsService.updateSetting('qwenVlUrl', this.state.qwenVlUrl);
    if (this.state.qwenVlModel !== undefined) SettingsService.updateSetting('qwenVlModel', this.state.qwenVlModel);
    if (this.state.titleLlmUrl !== undefined) SettingsService.updateSetting('titleLlmUrl', this.state.titleLlmUrl);
    if (this.state.titleLlmModel !== undefined) SettingsService.updateSetting('titleLlmModel', this.state.titleLlmModel);
    message.success('Settings saved. The new URLs and models will be used for future requests.');
    this.setState({ settingsModalVisible: false });
  };

  // FIX: Convert all methods to arrow functions to bind `this`
  handleSearch = ({ target }: { target: { value: string } }) => {
    this.setState({ search: target.value.toLowerCase() });
  };
  
  handleIgnoreSitesChange = (selectedSites: string[]) => {
    this.setState({ ignoreSites: selectedSites });
  };
  
  deleteSubmissions = (submissions: SubmissionPackage<any>[]) => {
    this.setState({ deleteModalVisible: false });
    Promise.all(
      submissions.map(s => SubmissionService.deleteSubmission(s.submission._id))
    ).finally(() => message.success('Submissions deleted.'));
  };

  postSubmissions = async (submissions: SubmissionPackage<any>[]) => {
    this.setState({ postModalVisible: false });
    for (let i = 0; i < submissions.length; i++) {
      try {
        await PostService.queue(submissions[i].submission._id);
      } catch {
        message.error(`Unable to queue ${SubmissionUtil.getSubmissionTitle(submissions[i])}.`);
      }
    }

    message.success('Submissions queued.');
  };
// Function to handle cascading schedule
cascadeReschedule = async (date: moment.Moment, platform: string) => {
  let rescheduleDate = moment(date).add(
    this.state.scheduleManyPeriod.d,
    'days'
  );
  rescheduleDate.add(this.state.scheduleManyPeriod.h, 'hours');
  rescheduleDate.add(this.state.scheduleManyPeriod.m, 'minutes');

  const platformSubmissions = this.props.submissions.filter(
    s =>
      (s.submission as any).platform === platform &&
      moment(s.submission.schedule.postAt).isSameOrAfter(date)
  );

  // Sort submissions by date
  platformSubmissions.sort((a, b) =>
    moment(a.submission.schedule.postAt).diff(b.submission.schedule.postAt)
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
};

//AUTO TAGGING
// --------------------------------------------------------------------------
// 1) Helper to gather only "affected" file submissions
// --------------------------------------------------------------------------
private generateAffectedFileSubmissions = (
  submissions: SubmissionPackage<any>[]
): ExtendedSubmissionPackage[] => {
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
};




// --------------------------------------------------------------------------
// 2) getAutoTags: calls the spawn-based getAutoTagsNoUI
// --------------------------------------------------------------------------
getAutoTags = async (imagePath: string) => {
  console.log('[Debug] getAutoTags called with:', imagePath);
  const result = await getAutoTagsNoUI(imagePath);
  console.log('[Debug] getAutoTags result for', imagePath, ':', result);
  return result; // { tags: string[], rating: string }
};

handleAutoTagSubmissions = async (submissions: SubmissionPackage<any>[]) => {
  this.setState({ autoTagSelectModalVisible: false });

  const fileSubs = this.generateAffectedFileSubmissions(submissions);
  this.setState({ 
    autoTagProgress: { current: 0, total: fileSubs.length } 
  });

  const autoTaggingResults = { ...this.state.autoTaggingResults };
  const tagValidationData: TagValidationData = {};

  for (let i = 0; i < fileSubs.length; i++) {
    const submission = fileSubs[i];
    const primary = (submission.submission as any).primary;
    const imagePath = primary.location;
    const ratingMapping: { [key: string]: string } = {
      "general": "Safe",
      "sensitive": "Suggestive",
      "questionable": "Suggestive",
      "explicit": "Explicit",
    };

    try {
      const result = await this.getAutoTags(imagePath);
      const normalizedRating = ratingMapping[result.rating.toLowerCase()] || result.rating;
      
      // Get sites this submission will be posted to
      const sites = Object.entries(submission.parts)
        .filter(([_, part]) => !(part as any).isDefault)
        .map(([key, _]) => key);
      
      // Validate tags for each site
      if (sites.length > 0) {
        const validationResult = await (window as any).tagValidatorApi.validateTags(result.tags, sites);
        
        // Store validation data
        tagValidationData[submission.submission._id] = {};
        
        validationResult.validations.forEach((validation: any) => {
          tagValidationData[submission.submission._id][validation.site] = {
            validTags: validation.validTags,
            discardedTags: validation.discardedTags
          };
        });
        
        // Use the valid tags for the default result
        const allValidTags = new Set<string>();
        validationResult.validations.forEach((v: any) => {
          v.validTags.forEach((t: string) => allValidTags.add(t));
        });
        
        autoTaggingResults[submission.submission._id] = {
          tags: Array.from(allValidTags),
          rating: normalizedRating,
          title: ''
        };
      } else {
        // No sites selected, use all tags
        autoTaggingResults[submission.submission._id] = {
          tags: result.tags,
          rating: normalizedRating,
          title: ''
        };
      }
    } catch (error) {
      console.error('Error auto-tagging submission', error);
    }

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

  this.setState({ autoTagProgress: null });

  const autoTaggingEdits: { [id: string]: AutoTagEdit } = {};
  for (const id in autoTaggingResults) {
    const normalizedRating = autoTaggingResults[id].rating.charAt(0).toUpperCase() + autoTaggingResults[id].rating.slice(1);
    autoTaggingEdits[id] = {
      tags: [...autoTaggingResults[id].tags],
      rating: normalizedRating,
      title: ''
    };
  }

  this.setState({
    autoTaggingResults,
    showAutoTagModal: true,
    autoTaggingEdits,
    tagValidationData 
  });
};

handleAutoTitleSubmissions = async (submissions: SubmissionPackage<any>[]) => {
  this.setState({ autoTitleSelectModalVisible: false });

  const fileSubs = this.generateAffectedFileSubmissions(submissions);
  this.setState({ 
    autoTagProgress: { current: 0, total: fileSubs.length } 
  });

  for (let i = 0; i < fileSubs.length; i++) {
    const s = fileSubs[i];
    const subId = s.submission._id;
    const primary = (s.submission as any).primary;
    if (!primary || !primary.location) continue;
    const imagePath = primary.location;

    let existingTags: string[] = [];
    let existingRating = 'General';

    if (this.state.autoTaggingResults[subId]?.tags?.length) {
      existingTags = this.state.autoTaggingResults[subId].tags;
      existingRating = this.state.autoTaggingResults[subId].rating || 'General';
    } else {
      const defaultPart = (s.parts as any).default || Object.values(s.parts || {}).find((p: any) => p.isDefault) || Object.values(s.parts || {})[0];
      const tagsObj = (defaultPart as any)?.data?.tags;
      if (Array.isArray(tagsObj)) {
        existingTags = tagsObj;
      } else if (tagsObj?.value && Array.isArray(tagsObj.value)) {
        existingTags = tagsObj.value;
      } else if (typeof tagsObj === 'object' && tagsObj !== null) {
        existingTags = Object.values(tagsObj).filter(v => typeof v === 'string') as string[];
      }
      const ratingVal = (defaultPart as any)?.data?.rating;
      if (typeof ratingVal === 'string') existingRating = ratingVal;
    }

    try {
      const newTitle = await getImageTitle(imagePath, existingTags, existingRating);

      // Update submission in backend
      const partsEntries = Object.entries(s.parts);
      const updatedEntries = partsEntries.map(([key, part]) => {
        if ((part as any).isDefault) {
          const updatedData = {
            ...((part as any).data || {}),
            title: newTitle
          };
          return [key, { ...(part as any), data: updatedData }] as const;
        }
        return [key, part] as const;
      });
      const updatedParts = Object.fromEntries(updatedEntries);
      const update = {
        id: subId,
        parts: Object.values(updatedParts),
        removedParts: [],
        altTexts: {}
      };
      await SubmissionService.updateSubmission(update);

      this.setState((prev) => ({
        autoTaggingResults: {
          ...prev.autoTaggingResults,
          [subId]: {
            ...(prev.autoTaggingResults[subId] || { tags: existingTags, rating: existingRating }),
            title: newTitle
          }
        },
        autoTaggingEdits: {
          ...(prev.autoTaggingEdits || {}),
          [subId]: {
            ...((prev.autoTaggingEdits && prev.autoTaggingEdits[subId]) || { tags: existingTags, rating: existingRating }),
            title: newTitle
          }
        }
      }));
    } catch (err) {
      console.error(`Failed to generate title for sub ${subId}`, err);
    }

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

  this.setState({ autoTagProgress: null });
  message.success('Titles generated for selected submissions!');
};

handleReAddDiscardedTag = (submissionId: string, site: string, tag: string) => {
  this.setState(prev => {
    const newValidationData = { ...prev.tagValidationData };
    const siteData = newValidationData[submissionId]?.[site];
    
    if (siteData) {
      // Move tag from discarded to valid
      siteData.validTags.push(tag);
      siteData.discardedTags = siteData.discardedTags.filter(d => d.tag !== tag);
      
      // Also add to autoTaggingEdits
      const currentEdit = prev.autoTaggingEdits![submissionId];
      if (currentEdit && !currentEdit.tags.includes(tag)) {
        return {
          tagValidationData: newValidationData,
          autoTaggingEdits: {
            ...prev.autoTaggingEdits!,
            [submissionId]: {
              ...currentEdit,
              tags: [...currentEdit.tags, tag]
            }
          }
        };
      }
    }
    
    return { tagValidationData: newValidationData };
  });
};

private regenerateTitle = async (sub: SubmissionPackage<any>) => {
  const submissionId = sub.submission._id;
  const edit = this.state.autoTaggingEdits?.[submissionId];
  if (!edit) return; // no data?

  const primary = (sub.submission as any).primary;
  const imagePath = primary.location;
  try {
    // Just call the Qwen script
    const newTitle = await getImageTitle(imagePath, edit.tags, edit.rating);
    // set new title in both autoTaggingEdits + autoTaggingResults
    this.setState((prev) => ({
      autoTaggingEdits: {
        ...prev.autoTaggingEdits,
        [submissionId]: {
          ...prev.autoTaggingEdits?.[submissionId],
          title: newTitle,
        },
      },
      autoTaggingResults: {
        ...prev.autoTaggingResults,
        [submissionId]: {
          ...prev.autoTaggingResults[submissionId],
          title: newTitle,
        },
      }
    }));
  } catch (err) {
    console.error('Error regenerating title', err);
    message.error('Failed to regenerate title');
  }
};

private generateAllTitles = async () => {
  const { autoTaggingEdits } = this.state;
  if (!autoTaggingEdits) return;

  // Gather all submissions that have tags
  const subList = this.props.submissions.filter(
    (s) => autoTaggingEdits[s.submission._id]?.tags?.length
  );

  const total = subList.length;

  for (let i = 0; i < total; i++) {
    const s = subList[i];
    const subId = s.submission._id;
    const edit = autoTaggingEdits[subId];
    if (!edit) continue;

    const primary = (s.submission as any).primary;
    const imagePath = primary.location;

    try {
      // Show "in-progress" in the 'title' placeholder
      const placeholder = `Generating title (${i + 1} / ${total})...`;
      this.setState((prev) => ({
        autoTaggingEdits: {
          ...prev.autoTaggingEdits!,
          [subId]: {
            ...prev.autoTaggingEdits![subId],
            title: placeholder
          }
        },
        autoTaggingResults: {
          ...prev.autoTaggingResults,
          [subId]: {
            ...prev.autoTaggingResults[subId],
            title: placeholder
          }
        }
      }));

      // Now call the python script to get the real title
      const newTitle = await getImageTitle(imagePath, edit.tags, edit.rating);

      // Finally, set the real title
      this.setState((prev) => ({
        autoTaggingEdits: {
          ...prev.autoTaggingEdits!,
          [subId]: {
            ...prev.autoTaggingEdits![subId],
            title: newTitle
          }
        },
        autoTaggingResults: {
          ...prev.autoTaggingResults,
          [subId]: {
            ...prev.autoTaggingResults[subId],
            title: newTitle
          }
        }
      }));
    } catch (err) {
      console.error(`Failed to generate title for sub ${subId}`, err);
      this.setState((prev) => ({
        autoTaggingEdits: {
          ...prev.autoTaggingEdits!,
          [subId]: {
            ...prev.autoTaggingEdits![subId],
            title: '[Error generating title]'
          }
        },
        autoTaggingResults: {
          ...prev.autoTaggingResults,
          [subId]: {
            ...prev.autoTaggingResults[subId],
            title: '[Error generating title]'
          }
        }
      }));
    }
  }

  message.success('All titles generated!');
};

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
};

handleRatingChange = (submissionId: string, rating: string) => {
  this.setState(prev => ({
    autoTaggingEdits: {
      ...prev.autoTaggingEdits!,
      [submissionId]: { ...prev.autoTaggingEdits![submissionId], rating }
    }
  }));
};

finalizeAutoTagEdits = async () => {
  const { autoTaggingEdits, tagValidationData } = this.state;
  if (!autoTaggingEdits) return;

  const submissions = this.props.submissions;
  for (const s of submissions) {
    const edit = autoTaggingEdits[s.submission._id];
    if (!edit) continue;

    const validationInfo = tagValidationData[s.submission._id];
    const partsEntries = Object.entries(s.parts);

    const updatedEntries = partsEntries.map(([key, part]) => {
      if ((part as any).isDefault) {
        // For default part, use the general edited tags
        const updatedData = {
          ...((part as any).data || {}),
          tags: {
            extendDefault: false,
            value: edit.tags
          },
          rating: ratingMap[edit.rating] || SubmissionRating.GENERAL,
          title: edit.title
        };
        return [key, { ...(part as any), data: updatedData }] as const;
      } else {
        // For site-specific parts, use validated tags if available
        const siteTags = validationInfo?.[key]?.validTags || edit.tags;
        const updatedData = {
          ...((part as any).data || {}),
          tags: {
            extendDefault: false,
            value: siteTags
          }
        };
        return [key, { ...(part as any), data: updatedData }] as const;
      }
    });

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
    autoTaggingEdits: undefined,
    tagValidationData: {}
  });
};


renderAutoTagModal = () => {
  const { showAutoTagModal, autoTaggingEdits, autoTaggingResults, tagValidationData } = this.state;
  if (!showAutoTagModal || !autoTaggingEdits || !autoTaggingResults) return null;

  const taggedSubmissions = this.props.submissions.filter(
    (s) => autoTaggingResults[s.submission._id]
  );

  return (
    <Modal
      title="Auto-Tagging Results"
      visible={showAutoTagModal}
      width={900}
      onCancel={() => this.setState({ showAutoTagModal: false })}
      onOk={this.finalizeAutoTagEdits}
      footer={[
        <Button
          key="generateAll"
          onClick={this.generateAllTitles}
        >
          Generate All Titles
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={this.finalizeAutoTagEdits}
        >
          OK
        </Button>
      ]}
    >
      <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
        <List
          dataSource={taggedSubmissions}
          renderItem={(submission: SubmissionPackage<any>) => {
            const edit = autoTaggingEdits[submission.submission._id];
            if (!edit) return null;
            
            const validationInfo = tagValidationData[submission.submission._id];
            // FIX: Add type assertion
            const hasDiscardedTags = validationInfo && 
              Object.values(validationInfo).some(v => (v as any).discardedTags.length > 0);
            
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
                        style={{ maxWidth: '250px', height: 'auto' }}
                      />
                    ) : null
                  }
                  title={
                    <>
                      {SubmissionUtil.getSubmissionTitle(submission)}
                      <br />
                      <small style={{ color: 'gray' }}>
                        Title: {autoTaggingResults[submission.submission._id].title}
                      </small>
                    </>
                  }
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
                                this.handleTagCheckboxChange(
                                  submission.submission._id, 
                                  tag, 
                                  e.target.checked
                                )
                              }
                            >
                              {tag}
                            </Checkbox>
                          ))}
                        </div>
                      </div>
                      
                      {/* Show validation warnings */}
                      {hasDiscardedTags && validationInfo && (
                        <Collapse 
                          style={{ marginTop: '10px', background: 'transparent' }}
                          defaultActiveKey={[]}
                        >
                          <Panel 
                            header={
                              <span style={{ color: '#ff4d4f' }}>
                                ⚠️ Some tags were removed for certain sites
                              </span>
                            } 
                            key="validation"
                          >
                            {Object.entries(validationInfo).map(([site, data]) => {
                              // FIX: Add type assertion
                              if ((data as any).discardedTags.length === 0) return null;
                              
                              return (
                                <Alert
                                  key={site}
                                  message={`Tags removed from ${site}`}
                                  description={
                                    <div>
                                      {/* FIX: Add type assertion */}
                                      {(data as any).discardedTags.map((discarded: any) => (
                                        <div key={discarded.tag} style={{ marginBottom: '8px' }}>
                                          <Tag color="error">{discarded.tag}</Tag>
                                          <span style={{ fontSize: '12px', color: '#666' }}>
                                            {discarded.reason}
                                          </span>
                                          <Button
                                            size="small"
                                            type="link"
                                            onClick={() => 
                                              this.handleReAddDiscardedTag(
                                                submission.submission._id,
                                                site,
                                                discarded.tag
                                              )
                                            }
                                          >
                                            Add anyway
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  }
                                  type="warning"
                                  style={{ marginBottom: '8px' }}
                                />
                              );
                            })}
                          </Panel>
                        </Collapse>
                      )}
                      
                      <div style={{ marginTop: '10px' }}>
                        <strong>Rating:</strong>
                        <Radio.Group
                          value={edit.rating}
                          onChange={e => 
                            this.handleRatingChange(submission.submission._id, e.target.value)
                          }
                        >
                          <Radio value="Safe">Safe</Radio>
                          <Radio value="Suggestive">Suggestive</Radio>
                          <Radio value="Explicit">Explicit</Radio>
                        </Radio.Group>
                      </div>
                      
                      <div style={{ marginTop: '10px' }}>
                        <strong>Generated Title:</strong> 
                        {autoTaggingResults[submission.submission._id].title}
                        <Button
                          type="link"
                          onClick={async () => {
                            const newTitle = await getImageTitle(
                              (submission.submission as any).primary.location,
                              autoTaggingEdits[submission.submission._id].tags,
                              autoTaggingEdits[submission.submission._id].rating
                            );
                            this.setState(prev => ({
                              autoTaggingEdits: {
                                ...prev.autoTaggingEdits!,
                                [submission.submission._id]: {
                                  ...prev.autoTaggingEdits![submission.submission._id],
                                  title: newTitle
                                }
                              },
                              autoTaggingResults: {
                                ...prev.autoTaggingResults,
                                [submission.submission._id]: {
                                  ...prev.autoTaggingResults[submission.submission._id],
                                  title: newTitle
                                }
                              }
                            }));
                          }}
                        >
                          Regenerate
                        </Button>
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
};







//SCHEDULE RE DONE
scheduleSubmissions = async (submissions: SubmissionPackage<any>[]) => {
  const { ignoreSites, applyCascadeToAllSites, enableCascade } = this.state;

  const allScheduledSubmissions = await SubmissionService.getScheduledSubmissions();

  const filteredSubmissions = submissions.filter(submission => {
    const websites = Object.values(submission.parts || {}).map(part => (part as any).website);
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

  // For non-cascade mode, compute a new date for each submission.
  let baseTime = moment(this.state.scheduleManyPeriod.time);
  const updatedSubmissions = filteredSubmissions.map(submission => {
    // Compute newDate based on baseTime
    const newDate = baseTime.format('YYYY-MM-DD HH:mm:ss');
    // Increment baseTime for the next submission
    baseTime.add(this.state.scheduleManyPeriod.d, 'days')
            .add(this.state.scheduleManyPeriod.h, 'hours')
            .add(this.state.scheduleManyPeriod.m, 'minutes');
    return {
      ...submission,
      newDate,
    } as ExtendedSubmissionPackage;
  });

  this.confirmScheduleSubmissions(updatedSubmissions)
};

generateAffectedSubmissionsList = (submissions: SubmissionPackage<any>[], startAt: moment.Moment) => {
  const { ignoreSites, applyCascadeToAllSites } = this.state;

  const affectedSubmissions = submissions
    .filter(submission => {
      const websites = Object.values(submission.parts || {}).map(part => (part as any).website);
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
};



confirmScheduleSubmissions = (submissions: ExtendedSubmissionPackage[]) => {
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
};





generateAffectedImagesList = (
  submissions: SubmissionPackage<any>[],
  startAt: moment.Moment
) => {
  const { ignoreSites, applyCascadeToAllSites } = this.state;

  console.log("Starting date for cascading:", startAt.format('YYYY-MM-DD HH:mm:ss'));

  // Sort submissions by original schedule date
  const sortedSubmissions = submissions
    .filter(submission => {
      const websites = Object.values(submission.parts || {}).map(part => (part as any).website);
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
};






// Toggle cascade option
toggleCascade = () => {
  this.setState({ enableCascade: !this.state.enableCascade });
};
  onDragEnd = (result: DropResult) => {
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
  };

  
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
              <Select
                mode="multiple"
                placeholder="Select sites to ignore"
                style={{ width: '100%', marginTop: '10px' }}
                onChange={this.handleIgnoreSitesChange}
                value={this.state.ignoreSites}
              >
                {sites.map(site => (
                  // FIX: Use Select.Option
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
          <DragDropContext onDragEnd={this.onDragEnd}>
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
                              type="primary"
                              className="mr-1"
                              onClick={() => {
                                console.log('Auto-Title Many button clicked');
                                this.setState({ autoTitleSelectModalVisible: true });
                              }}
                              disabled={!submissions.length}
                            >
                              Auto-Title Many
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
                            type="default"
                            className="mr-1"
                            onClick={() => this.setState({ settingsModalVisible: true })}
                          >
                            Settings
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
                          onOk={this.deleteSubmissions}
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
                          onOk={this.handleAutoTagSubmissions}
                          ignorePosting={true}
                          ignoreScheduled={true}
                        >
                          <p>Select which submissions you want to auto-tag.</p>
                        </SubmissionSelectModal>
                        <SubmissionSelectModal
                          visible={this.state.autoTitleSelectModalVisible}
                          validOnly={true}
                          title="Auto-Title"
                          multiple={true}
                          selectAll={true}
                          submissionType={_.get(
                            this.props.submissions[0],
                            'submission.type',
                            SubmissionType.FILE
                          )}
                          onClose={() => this.setState({ autoTitleSelectModalVisible: false })}
                          onOk={this.handleAutoTitleSubmissions}
                          ignorePosting={true}
                          ignoreScheduled={true}
                        >
                          <p>Select which submissions you want to auto-title using their existing tags.</p>
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
                          onOk={this.postSubmissions}
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
                      onOk={this.scheduleSubmissions}
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
      <Modal
          title="Settings"
          visible={this.state.settingsModalVisible}
          onOk={this.handleSaveSettings}
          onCancel={() => this.setState({ settingsModalVisible: false })}
        >
          <Form layout="vertical">
            <Form.Item label="AI Title Generator URL" help="Legacy / fallback full URL to the title generation service.">
              <Input
                value={this.state.titleGeneratorUrl}
                onChange={e => this.setState({ titleGeneratorUrl: e.target.value })}
                placeholder="http://127.0.0.1:37914/generate"
              />
            </Form.Item>
            <Form.Item label="Qwen VL URL (Hop 1)" help="Endpoint for Qwen2.5-VL vision model (e.g., vLLM /v1/chat/completions).">
              <Input
                value={this.state.qwenVlUrl}
                onChange={e => this.setState({ qwenVlUrl: e.target.value })}
                placeholder="http://127.0.0.1:8000/v1/chat/completions"
              />
            </Form.Item>
            <Form.Item label="Qwen VL Model Name (Hop 1)" help="Model identifier for Qwen2.5-VL.">
              <Input
                value={this.state.qwenVlModel}
                onChange={e => this.setState({ qwenVlModel: e.target.value })}
                placeholder="Qwen2.5-VL-72B-Instruct-AWQ"
              />
            </Form.Item>
            <Form.Item label="Title LLM URL (Hop 2 - SillyTavern)" help="Endpoint for text LLM title generation (e.g., SillyTavern /v1/chat/completions).">
              <Input
                value={this.state.titleLlmUrl}
                onChange={e => this.setState({ titleLlmUrl: e.target.value })}
                placeholder="http://127.0.0.1:5000/v1/chat/completions"
              />
            </Form.Item>
            <Form.Item label="Title LLM Model Name (Hop 2)" help="Model identifier for title LLM.">
              <Input
                value={this.state.titleLlmModel}
                onChange={e => this.setState({ titleLlmModel: e.target.value })}
                placeholder="models--ReadyArt--Forgotten-Safeword-12B-v4.0"
              />
            </Form.Item>
          </Form>
        </Modal>
      {this.renderAutoTagModal()}
      </>
  );
  }
}
