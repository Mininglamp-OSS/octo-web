import React from "react";

export interface UserInfoFooterProps {
    action?: React.ReactNode;
    hint?: React.ReactNode;
}

function UserInfoFooter({ action, hint }: UserInfoFooterProps) {
    if (!action && !hint) {
        return null;
    }

    return <div className="wk-userInfo-footer">
        {
            hint ? <div className="wk-userinfo-footer-external-hint">
                {hint}
            </div> : <div className="wk-userinfo-footer-sendbutton">
                {action}
            </div>
        }
    </div>
}

export default UserInfoFooter;
export { UserInfoFooter };
