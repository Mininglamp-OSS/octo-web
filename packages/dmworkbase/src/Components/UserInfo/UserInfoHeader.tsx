import React from "react";
import AiBadge from "../AiBadge";
import RealnameVerifiedBadge from "../RealnameVerifiedBadge";
import UserInfoMetaList, { UserInfoMetaItem } from "./UserInfoMetaList";

export interface UserInfoHeaderProps {
    avatar: React.ReactNode;
    displayName?: React.ReactNode;
    isBot?: boolean;
    isRealnameVerified?: boolean;
    metaItems?: UserInfoMetaItem[];
}

function UserInfoHeader({
    avatar,
    displayName,
    isBot,
    isRealnameVerified,
    metaItems = [],
}: UserInfoHeaderProps) {
    return <div className="wk-userinfo-header">
        <div className="wk-userinfo-user">
            <div className="wk-userinfo-user-avatar">
                {avatar}
            </div>
            <div className="wk-userinfo-user-info">
                <div className="wk-userinfo-user-info-name">
                    <span className="wk-userinfo-display-name">{displayName}</span>
                    {isBot && <AiBadge />}
                    {isRealnameVerified && <RealnameVerifiedBadge />}
                </div>
                <div className="wk-userinfo-user-info-others">
                    <UserInfoMetaList items={metaItems} />
                </div>
            </div>
        </div>
    </div>
}

export default UserInfoHeader;
export { UserInfoHeader };
