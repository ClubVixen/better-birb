import { Alert, Button, Form, Icon, Input, message } from 'antd';
import { TwitterAccountData } from 'postybirb-commons';
import React from 'react';
import BrowserLink from '../../components/BrowserLink';
import LoginService from '../../services/login.service';
import axios from '../../utils/http';
import { LoginDialogProps } from '../interfaces/website.interface';

interface State {
  key: string;
  secret: string;
  pin: string;
  authorization?: { url: string; oauth_token: string };
  busy?: 'saving' | 'requesting' | 'verifying';
  error?: string;
}

interface AuthorizationResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

export class TwitterLogin extends React.Component<LoginDialogProps, State> {
  private savedCredentials = {
    key: (this.props.data as Partial<TwitterAccountData>)?.key || '',
    secret: (this.props.data as Partial<TwitterAccountData>)?.secret || '',
  };

  state: State = { ...this.savedCredentials, pin: '' };

  private saveCredentials = async () => {
    const credentials = { key: this.state.key.trim(), secret: this.state.secret.trim() };
    this.setState({ busy: 'saving', error: undefined, authorization: undefined, pin: '' });
    try {
      await LoginService.setAccountData(this.props.account._id, credentials);
      this.savedCredentials = credentials;
      message.success('X API Key and API Key Secret saved.');
    } catch {
      this.setState({ error: 'Better Birb could not save the X API credentials.' });
    } finally {
      this.setState({ busy: undefined });
    }
  };

  private requestAuthorization = async () => {
    this.setState({ busy: 'requesting', error: undefined, authorization: undefined, pin: '' });
    try {
      const { data } = await axios.post<AuthorizationResponse<NonNullable<State['authorization']>>>(
        '/twitter/v2/authorize/start',
        { key: this.state.key.trim(), secret: this.state.secret.trim() },
      );
      if (!data.success || !data.data) {
        this.setState({ error: data.error || 'X did not provide an authorization link.' });
        return;
      }
      this.setState({ authorization: data.data });
      await window.electron.shell.openInBrowser(data.data.url);
    } catch {
      this.setState(state => ({
        error: state.authorization
          ? 'Could not open your browser. Use the authorization link below.'
          : 'Better Birb could not start X authorization. Try again.',
      }));
    } finally {
      this.setState({ busy: undefined });
    }
  };

  private verifyPin = async () => {
    const { authorization, pin } = this.state;
    if (!authorization) return;
    const credentials = { key: this.state.key.trim(), secret: this.state.secret.trim() };
    this.setState({ busy: 'verifying', error: undefined });
    try {
      const { data } = await axios.post<AuthorizationResponse<Partial<TwitterAccountData>>>(
        '/twitter/v2/authorize',
        { ...credentials, oauth_token: authorization.oauth_token, verifier: pin.trim() },
      );
      if (!data.success || !data.data) {
        this.setState({ error: data.error || 'X did not verify the PIN.' });
        return;
      }
      await LoginService.setAccountData(this.props.account._id, { ...credentials, ...data.data });
      this.savedCredentials = credentials;
      this.setState({ authorization: undefined, pin: '' });
      message.success('X account authenticated.');
    } catch {
      this.setState({ error: 'Better Birb could not finish X authorization. Open a new authorization page and try again.' });
    } finally {
      this.setState({ busy: undefined });
    }
  };

  render() {
    const { key, secret, pin, authorization, busy, error } = this.state;
    const hasCredentials = !!key.trim() && !!secret.trim();
    const credentialsChanged =
      key.trim() !== this.savedCredentials.key || secret.trim() !== this.savedCredentials.secret;

    return (
      <div className="container">
        <Form layout="vertical">
          <h1>Twitter / X API Key and Secret</h1>
          <p>
            <BrowserLink url="https://www.postybirb.com/twitter-setup.html">
              How to get your API Key and API Key Secret <Icon type="link" />
            </BrowserLink>
          </p>
          {error && <Alert type="error" message={error} showIcon />}
          <Form.Item label="X API Key" required>
            <Input
              value={key}
              disabled={!!busy}
              onChange={({ target }) =>
                this.setState({ key: target.value, authorization: undefined, pin: '', error: undefined })
              }
            />
          </Form.Item>
          <Form.Item label="X API Key Secret" required>
            <Input.Password
              value={secret}
              disabled={!!busy}
              onChange={({ target }) =>
                this.setState({ secret: target.value, authorization: undefined, pin: '', error: undefined })
              }
            />
          </Form.Item>
          <Form.Item>
            <Button
              onClick={this.saveCredentials}
              disabled={!hasCredentials || !credentialsChanged || !!busy}
              loading={busy === 'saving'}
            >
              Save API Key and Secret
            </Button>
            <Button
              type="primary"
              style={{ marginLeft: '0.5em' }}
              onClick={this.requestAuthorization}
              disabled={!hasCredentials || !!busy}
              loading={busy === 'requesting'}
            >
              Open X Authorization in Browser
            </Button>
          </Form.Item>
          {authorization && (
            <>
              <p>
                Approve the app in your browser, then enter the PIN shown by X.{' '}
                <BrowserLink url={authorization.url}>Open the authorization page again</BrowserLink>
              </p>
              <Form.Item label="Authentication PIN" required>
                <Input
                  value={pin}
                  disabled={!!busy}
                  onChange={({ target }) => this.setState({ pin: target.value })}
                  addonAfter={
                    <Button
                      onClick={this.verifyPin}
                      disabled={!/^\d+$/.test(pin.trim()) || !!busy}
                      loading={busy === 'verifying'}
                    >
                      Authorize
                    </Button>
                  }
                />
              </Form.Item>
            </>
          )}
        </Form>
      </div>
    );
  }
}
