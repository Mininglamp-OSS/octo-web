import React, { useEffect, useState } from 'react';
import { useI18n } from '@octo/base';
import { Button, Spin } from '@douyinfe/semi-ui';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import * as api from '../api/driveApi';
import { DriveApiError } from '../api/driveApi';
import type { AcceptInviteResult } from '../bridge/types';
import './LandingPage.css';

/**
 * Space-invite acceptance landing page at `/drive/invite/:token`.
 *
 * Accepts the invite on mount via the authed `POST /invites/:token/accept`
 * (octo-web is always behind login, so the recipient is authenticated by the
 * time this mounts). On success the user is a member of the space; "enter
 * drive" hands off to the main view. `already_member` is a success too — the
 * link is idempotent.
 */

type View =
  | { kind: 'accepting' }
  | { kind: 'joined'; result: AcceptInviteResult }
  | { kind: 'invalid' }
  | { kind: 'error' };

export interface InviteLandingPageProps {
  token: string;
  /** Leave the landing page and enter the main drive view. */
  onExit?: () => void;
}

/** Map a drive role to its existing i18n label, falling back to the raw role. */
const ROLE_KEY: Record<string, string> = {
  editor: 'drive.invite.roleEditor',
  uploader_downloader: 'drive.invite.roleUploaderDownloader',
  downloader: 'drive.invite.roleDownloader',
  preview_only: 'drive.invite.rolePreview',
};

export default function InviteLandingPage({ token, onExit }: InviteLandingPageProps) {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'accepting' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api.acceptInvite(token);
        if (active) setView({ kind: 'joined', result });
      } catch (err) {
        if (!active) return;
        const notFound = err instanceof DriveApiError && err.code === 'not_found';
        const denied = err instanceof DriveApiError && err.code === 'permission_denied';
        setView({ kind: notFound || denied ? 'invalid' : 'error' });
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const roleLabel = (role: string) => (ROLE_KEY[role] ? t(ROLE_KEY[role]) : role);

  return (
    <div className="drive-landing">
      <div className="drive-landing__card">
        {view.kind === 'accepting' && (
          <div className="drive-landing__center">
            <Spin />
            <p className="drive-landing__muted">{t('drive.landing.invite.accepting')}</p>
          </div>
        )}

        {view.kind === 'joined' && (
          <div className="drive-landing__body">
            <CheckCircle size={40} className="drive-landing__icon drive-landing__icon--ok" />
            <h2 className="drive-landing__title">
              {t(
                view.result.already_member
                  ? 'drive.landing.invite.alreadyTitle'
                  : 'drive.landing.invite.joinedTitle',
              )}
            </h2>
            <p className="drive-landing__muted">
              {t('drive.landing.invite.role')}: {roleLabel(view.result.role)}
            </p>
            <Button theme="solid" block onClick={onExit}>
              {t('drive.landing.invite.enterDrive')}
            </Button>
          </div>
        )}

        {(view.kind === 'invalid' || view.kind === 'error') && (
          <div className="drive-landing__body">
            <AlertTriangle size={40} className="drive-landing__icon drive-landing__icon--warn" />
            <h2 className="drive-landing__title">{t(`drive.landing.invite.${view.kind}Title`)}</h2>
            <p className="drive-landing__muted">{t(`drive.landing.invite.${view.kind}Body`)}</p>
            {onExit && (
              <Button theme="borderless" block onClick={onExit}>
                {t('drive.landing.invite.enterDrive')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
