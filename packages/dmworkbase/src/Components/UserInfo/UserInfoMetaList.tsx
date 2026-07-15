import React from "react";

export interface UserInfoMetaItem {
    label: React.ReactNode;
    value: React.ReactNode;
}

export interface UserInfoMetaListProps {
    items: UserInfoMetaItem[];
}

function UserInfoMetaList({ items }: UserInfoMetaListProps) {
    const visibleItems = items.filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
    if (visibleItems.length === 0) {
        return null;
    }

    return <ul className="wk-userinfo-meta-list">
        {
            visibleItems.map((item, index) => {
                return <li key={index} className="wk-userinfo-meta-item">
                    <span className="wk-userinfo-meta-label">{item.label}</span>
                    <span className="wk-userinfo-meta-value">{item.value}</span>
                </li>
            })
        }
    </ul>
}

export default UserInfoMetaList;
export { UserInfoMetaList };
