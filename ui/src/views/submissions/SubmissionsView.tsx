import React from 'react';
import _ from 'lodash';
import SubmissionLogs from './SubmissionLogs';
import { EditableSubmissions } from './editable-submissions/EditableSubmissions';
import { headerStore } from '../../stores/header.store';
import { SubmissionStore } from '../../stores/submission.store';
import { inject, observer } from 'mobx-react';
import { SubmissionType } from 'postybirb-commons';
import { Match, Location } from 'react-router-dom';
import { Tabs, Badge, Select } from 'antd';
import ScheduledSubmissions from './scheduled-submissions/ScheduledSubmissions';
import { uiStore } from '../../stores/ui.store';
import SubmissionQueue from './SubmissionQueue';

const { Option } = Select;

interface Props {
  submissionStore?: SubmissionStore;
  match: Match;
  location: Location;
  history: any;
}

interface State {
  selectedSite: string | null;
}

@inject('submissionStore')
@observer
export default class SubmissionView extends React.Component<Props, State> {
  type: SubmissionType = SubmissionType.FILE;
  defaultKey: string = 'submissions';

  constructor(props: Props) {
    super(props);
    uiStore.setActiveNav('update'); // force an update

    this.state = {
      selectedSite: null, // Initialize the selected site state
    };

    switch (props.match.path.split('/').pop()) {
      case SubmissionType.FILE:
        this.type = SubmissionType.FILE;
        break;
      case SubmissionType.NOTIFICATION:
        this.type = SubmissionType.NOTIFICATION;
        break;
    }

    const hashPart = location.hash.split('/').pop(); // eslint-disable-line no-restricted-globals
    if (hashPart === this.type) {
      this.defaultKey = 'submissions';
    } else {
      this.defaultKey = hashPart || 'submissions';
    }

    headerStore.updateHeaderState({
      title: 'Submissions',
      routes: [
        {
          path: `/${this.type}`,
          breadcrumbName: `${_.capitalize(this.type)} Submissions`
        }
      ]
    });
  }

  handleSiteChange = (value: string) => {
    this.setState({ selectedSite: value });
  };

  render() {
    const { selectedSite } = this.state;

    const submissions =
      this.type === SubmissionType.FILE
        ? this.props.submissionStore!.fileSubmissions
        : this.props.submissionStore!.notificationSubmissions;

    const editableSubmissions = submissions.filter(
      s => !s.submission.isPosting && !s.submission.isQueued && !s.submission.schedule.isScheduled
    );

    const scheduledSubmissions = submissions.filter(
      s => !s.submission.isPosting && !s.submission.isQueued && s.submission.schedule.isScheduled
    ).filter(s => {
      const partsArray = Object.values(s.parts || {}); // Convert parts object to an array
      return !selectedSite || partsArray.some(part => part.website === selectedSite);
    }); // Use the `website` property

    const queuedSubmissions = submissions.filter(
      s => s.submission.isPosting || s.submission.isQueued
    );

    return (
      <Tabs
        className="overflow-y-auto h-full bg-inherit"
        style={{ overflowY: 'auto' }}
        tabBarStyle={{ zIndex: 10, backgroundColor: 'inherit', position: 'sticky', top: 0 }}
        defaultActiveKey={this.defaultKey}
        onTabClick={(key: string) => {
          this.props.history.replace(`/${this.type}/${key}`);
        }}
      >
        <Tabs.TabPane
          tab={
            <div>
              <span className="mr-1">Submissions</span>
              <Badge count={editableSubmissions.length} />
            </div>
          }
          key="submissions"
        >
          <div className="submission-view">
            <EditableSubmissions
              isLoading={this.props.submissionStore!.isLoading}
              submissions={editableSubmissions}
              type={this.type}
            />
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane
          tab={
            <div>
              <span className="mr-1">Scheduled</span>
              <Badge count={scheduledSubmissions.length} />
            </div>
          }
          key="scheduled"
        >
          <div className="scheduled-view">
            {/* Add a dropdown to filter by site */}
            <Select
              placeholder="Filter by Site"
              onChange={this.handleSiteChange}
              style={{ width: 200, marginBottom: 16 }}
              allowClear
            >
              {/* Populate with available sites */}
              {_.uniq(
                submissions.flatMap(s => {
                  const partsArray = Object.values(s.parts || {}); // Convert parts object to an array
                  return partsArray.map(part => part.website);
                })
              ).map(site => (
                <Option key={site} value={site}>
                  {site}
                </Option>
              ))}
            </Select>

            <ScheduledSubmissions submissions={scheduledSubmissions} />
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane
          tab={
            <div>
              <span className="mr-1">Posting</span>
              <Badge count={queuedSubmissions.length} />
            </div>
          }
          key="posting"
        >
          <SubmissionQueue type={this.type} />
        </Tabs.TabPane>
        <Tabs.TabPane tab="Logs" key="logs">
          <SubmissionLogs type={this.type} />
        </Tabs.TabPane>
      </Tabs>
    );
  }
}
