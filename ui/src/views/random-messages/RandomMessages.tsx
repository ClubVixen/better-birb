// src/views/random-messages/RandomMessages.tsx
import React from 'react';
import { inject, observer } from 'mobx-react';
import { RandomMessageStore } from '../../stores/random-message.store';
import RandomMessageService from '../../services/random-message.service';
import { RandomMessage, RandomMessageEvent } from 'postybirb-commons';
import { Empty, Button, Form, message, Spin, Card, Input, Icon, Popconfirm } from 'antd';

interface Props {
  randomMessageStore?: RandomMessageStore;
}

@inject('randomMessageStore')
@observer
export default class RandomMessages extends React.Component<Props> {

  createNewRandomMessage() {
    RandomMessageService.create({
      title: 'New Random Messages',
      messages: ['First Message', 'Second Message'],
      description: ''
    })
      .then(() => message.success('Random message set created.'))
      .catch(() => message.error('Failed to create random message set.'));
  }

  render() {
    const store = this.props.randomMessageStore!;
    const all = store.messages;
    return (
      <div>
        {all.length ? (
          <div>
            <Button type="primary" className="mb-2" onClick={() => this.createNewRandomMessage()}>
              Add New Random Message Set
            </Button>
            {all.map((rm: RandomMessage) => (
              <div key={rm._id} className="mb-2">
                <RandomMessageEditor msg={rm} />
              </div>
            ))}
          </div>
        ) : (
          <Empty description={<span>No random message sets found</span>}>
            <Button type="primary" onClick={() => this.createNewRandomMessage()}>
              Create
            </Button>
          </Empty>
        )}
      </div>
    );
  }
}

interface EditorProps {
  msg: RandomMessage;
}

interface EditorState {
  workingCopy: Partial<RandomMessage>;
  touched: boolean;
  saving: boolean;
}

/**
 * Similar to your "DescriptionTemplateEditor" in the question
 */
class RandomMessageEditor extends React.Component<EditorProps, EditorState> {
  private original!: RandomMessage;

  constructor(props: EditorProps) {
    super(props);
    this.state = {
      workingCopy: { ...props.msg },
      touched: false,
      saving: false
    };
    this.original = { ...props.msg };
  }

  handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value.trim();
    const copy = { ...this.state.workingCopy, title: newVal };
    this.setState({
      workingCopy: copy,
      touched: JSON.stringify(copy) !== JSON.stringify(this.original)
    });
  };

  handleDescChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    const copy = { ...this.state.workingCopy, description: newVal };
    this.setState({
      workingCopy: copy,
      touched: JSON.stringify(copy) !== JSON.stringify(this.original)
    });
  };

  handleMessagesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean);
    const copy = { ...this.state.workingCopy, messages: lines };
    this.setState({
      workingCopy: copy,
      touched: JSON.stringify(copy) !== JSON.stringify(this.original)
    });
  };

  onSave = () => {
    if (!this.state.touched) {
      message.info('No changes to save.');
      return;
    }
    this.setState({ saving: true });
    RandomMessageService.update(this.state.workingCopy)
      .then(() => {
        this.setState({ saving: false, touched: false });
        message.success('Random message set updated.');
      })
      .catch(() => {
        this.setState({ saving: false });
        message.error('Failed to update random message set.');
      });
  };

  onDelete = () => {
    if (!this.original._id) {
      return;
    }
    RandomMessageService.remove(this.original._id)
      .then(() => {
        message.success('Random message set removed.');
      })
      .catch(() => {
        message.error('Failed to remove random message set.');
      });
  };

  render() {
    const { workingCopy } = this.state;

    return (
      <Spin spinning={this.state.saving}>
        <Form layout="vertical">
          <Card
            size="small"
            title={
              <Input
                defaultValue={workingCopy.title}
                onBlur={this.handleTitleChange}
                placeholder="Title"
                required
              />
            }
            actions={[
              <Icon type="save" key="save" onClick={this.onSave} />,
              <Popconfirm title="Are you sure?" onConfirm={this.onDelete}>
                <Icon type="delete" key="delete" />
              </Popconfirm>
            ]}
          >
            <Form.Item label="Description / Info (optional)">
              <Input
                defaultValue={workingCopy.description}
                onBlur={this.handleDescChange}
                placeholder="Describe what these messages are for (optional)"
              />
            </Form.Item>
            <Form.Item label="Messages (one per line)">
              <Input.TextArea
                rows={5}
                defaultValue={workingCopy.messages ? workingCopy.messages.join('\n') : ''}
                onBlur={this.handleMessagesChange}
              />
            </Form.Item>
          </Card>
        </Form>
      </Spin>
    );
  }
}
