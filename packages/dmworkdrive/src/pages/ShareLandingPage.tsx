import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '@octo/base';
import { Button, Input, Spin, Tag } from '@douyinfe/semi-ui';
import { Download, FileText, Lock, AlertTriangle } from 'lucide-react';
import * as api from '../api/driveApi';
import { DriveApiError } from '../api/driveApi';
import type { ShareAccess } from '../bridge/types';
import { formatBytes, formatTime } from '../utils/format';
import { triggerBrowserDownload } from '../utils/download';
import { Toast } from '../utils/toast';
import './LandingPage.css';

/**
 * Public share-access landing page at `/drive/s/:id` (the share id doubles as
 * the access token). Validates the token — prompting for a password when the
 * share is password-gated — then shows the file metadata returned by the
 * public `POST /v1/drive/public/shares/:token/access` endpoint.
 *
 * Download goes through the public `POST /v1/drive/public/shares/:token/download`
 * endpoint: it re-checks the same token+password+expiry and returns the
 * anonymous object-storage URL, so an external (unauthenticated) recipient
 * downloads the bytes directly without drive membership.
 */

type View =
  | { kind: 'loading' }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'ready'; access: ShareAccess }
  | { kind: 'expired' }
  | { kind: 'invalid' }
  | { kind: 'error' };

export interface ShareLandingPageProps {
  token: string;
  /** Leave the landing page and enter the main drive view. */
  onExit?: () => void;
}

/**
 * Classify an access() failure into the terminal/password view to render.
 *
 * Keyed on the server `error` code (see TASK-I1): the backend splits share
 * failures into distinct codes, so we no longer parse (localizable) message
 * text. `password_required` vs `wrong_password` distinguishes "no password
 * given" from "wrong password" directly — no need to infer from submit state.
 */
function classify(err: unknown): View {
  if (err instanceof DriveApiError) {
    switch (err.code) {
      case 'password_required':
        return { kind: 'password', wrong: false };
      case 'wrong_password':
        return { kind: 'password', wrong: true };
      case 'share_expired':
        return { kind: 'expired' };
      case 'not_found':
        return { kind: 'invalid' };
    }
  }
  return { kind: 'error' };
}

export default function ShareLandingPage({ token, onExit }: ShareLandingPageProps) {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const access = useCallback(
    async (pwd?: string) => {
      try {
        const result = await api.accessShareByToken(token, pwd);
        setView({ kind: 'ready', access: result });
      } catch (err) {
        setView(classify(err));
      }
    },
    [token],
  );

  useEffect(() => {
    void access();
  }, [access]);

  const submitPassword = useCallback(async () => {
    const pwd = password.trim();
    if (!pwd || submitting) return;
    setSubmitting(true);
    await access(pwd);
    setSubmitting(false);
  }, [password, submitting, access]);

  const handleDownload = useCallback(async () => {
    if (view.kind !== 'ready') return;
    try {
      // Same token+password the access() call used (empty for unprotected shares).
      const pwd = password.trim() || undefined;
      const { url, filename } = await api.downloadShareByToken(token, pwd);
      api.assertSafeUploadURL(url);
      triggerBrowserDownload(url, filename || view.access.file_name);
    } catch {
      Toast.error(t('drive.download.failed'));
    }
  }, [view, token, password, t]);

  const permLabel = (permission: string) =>
    permission === 'download'
      ? t('drive.landing.share.permDownload')
      : t('drive.landing.share.permView');

  return (
    <div className="drive-landing">
      <div className="drive-landing__card">
        {view.kind === 'loading' && (
          <div className="drive-landing__center">
            <Spin />
            <p className="drive-landing__muted">{t('drive.landing.share.loading')}</p>
          </div>
        )}

        {view.kind === 'password' && (
          <div className="drive-landing__body">
            <Lock size={40} className="drive-landing__icon" />
            <h2 className="drive-landing__title">{t('drive.landing.share.passwordTitle')}</h2>
            <Input
              mode="password"
              value={password}
              onChange={setPassword}
              placeholder={t('drive.landing.share.passwordPlaceholder')}
              onEnterPress={submitPassword}
            />
            {view.wrong && (
              <p className="drive-landing__err">{t('drive.landing.share.passwordWrong')}</p>
            )}
            <Button theme="solid" block loading={submitting} onClick={submitPassword}>
              {t('drive.landing.share.passwordSubmit')}
            </Button>
          </div>
        )}

        {view.kind === 'ready' && (
          <div className="drive-landing__body">
            <FileText size={40} className="drive-landing__icon" />
            <h2 className="drive-landing__title">{view.access.file_name}</h2>
            <div className="drive-landing__meta">
              <span>{formatBytes(view.access.file_size)}</span>
              <Tag size="small">{permLabel(view.access.permission)}</Tag>
              {view.access.expires_at && (
                <span className="drive-landing__muted">
                  {t('drive.landing.share.expiresAt')} {formatTime(view.access.expires_at)}
                </span>
              )}
            </div>
            {view.access.permission === 'download' && (
              <Button
                theme="solid"
                block
                icon={<Download size={16} />}
                onClick={handleDownload}
              >
                {t('drive.landing.share.download')}
              </Button>
            )}
            {onExit && (
              <Button theme="borderless" block onClick={onExit}>
                {t('drive.landing.share.enterDrive')}
              </Button>
            )}
          </div>
        )}

        {(view.kind === 'expired' || view.kind === 'invalid' || view.kind === 'error') && (
          <div className="drive-landing__body">
            <AlertTriangle size={40} className="drive-landing__icon drive-landing__icon--warn" />
            <h2 className="drive-landing__title">{t(`drive.landing.share.${view.kind}Title`)}</h2>
            <p className="drive-landing__muted">{t(`drive.landing.share.${view.kind}Body`)}</p>
            {onExit && (
              <Button theme="borderless" block onClick={onExit}>
                {t('drive.landing.share.enterDrive')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
