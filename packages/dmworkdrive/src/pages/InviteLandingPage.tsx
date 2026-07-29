import React, { useEffect, useState } from 'react';
import { useI18n } from '@octo/base';
import { Button, Spin } from '@douyinfe/semi-ui';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import * as api from '../api/driveApi';
import { DriveApiError } from '../api/driveApi';
import type { AcceptInviteResult, DriveRole } from '../bridge/types';
import { ROLE_LABEL_KEY } from '../utils/roleLabel';
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
  /**
   * Called whenever the stashed standalone return target should be dropped — i.e.
   * on any outcome EXCEPT a genuine session 401. A successful (or already_member)
   * accept, an invalid/denied invite, a 5xx or a network error all clear the
   * up-front-stashed deep-link so a later account on the same tab can't replay this
   * invite URL and auto-accept under a different identity (PR#1146 R10). Only a
   * session 401 (which triggers global logout) retains the stash for post-login
   * return.
   */
  onClearReturn?: () => void;
}

export default function InviteLandingPage({ token, onExit, onClearReturn }: InviteLandingPageProps) {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ kind: 'accepting' });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await api.acceptInvite(token);
        // Success proves the session; drop the stashed return target.
        onClearReturn?.();
        if (active) setView({ kind: 'joined', result });
      } catch (err) {
        if (!active) return;
        // Retain the stash ONLY for a session 401 (logout fired → return after
        // re-login). Clearing on every other failure stops a later account from
        // replaying this invite URL and auto-accepting under a new identity (R10).
        if (!api.isSessionExpiredError(err)) onClearReturn?.();
        const notFound = err instanceof DriveApiError && err.code === 'not_found';
        const denied = err instanceof DriveApiError && err.code === 'permission_denied';
        setView({ kind: notFound || denied ? 'invalid' : 'error' });
      }
    })();
    return () => {
      active = false;
    };
  }, [token, onClearReturn]);

  // Use the shared role→label SSOT (roleLabel.ts) so the landing page renders
  // role names identically to the member roster / org picker — and covers all
  // roles (the prior local map omitted admin/super_admin/custom).
  const roleLabel = (role: string) => {
    const key = ROLE_LABEL_KEY[role as DriveRole];
    return key ? t(key) : role;
  };

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
