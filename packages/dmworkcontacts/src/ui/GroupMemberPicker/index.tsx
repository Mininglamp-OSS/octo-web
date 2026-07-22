import React from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Input,
  Space,
} from "@douyinfe/semi-ui";

import WKAvatar from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";

import type { GroupMemberPickerProps } from "./types";
import "./index.css";

function GroupMemberPicker({
  mode,
  candidates,
  selected,
  selectedUids,
  keyword,
  copy,
  avatarForUid,
  actions,
}: GroupMemberPickerProps) {
  const memberList = (
    <div className="wk-organizational-group-new-left">
      <div className="group-new-left-search">
        <Input
          className="group-new-left-search-input"
          placeholder={copy.searchPlaceholder}
          value={keyword}
          showClear
          onChange={actions.onKeywordChange}
        />
      </div>
      <div className="group-new-left-main">
        <div className="friend-opt">
          <div className="friend-opt-main">
            <CheckboxGroup
              style={{ width: "100%" }}
              value={Array.from(selectedUids)}
              onChange={(values) => {
                const next = new Set(values);
                candidates.forEach((member) => {
                  if (next.has(member.uid) !== selectedUids.has(member.uid)) {
                    actions.onToggleMember(member.uid);
                  }
                });
              }}
            >
              {candidates.map((member) => (
                <Checkbox
                  key={member.uid}
                  value={member.uid}
                  className="friend-opt-item"
                >
                  <WKAvatar
                    src={member.avatar || avatarForUid(member.uid)}
                    style={{
                      width: "24px",
                      height: "24px",
                      marginRight: "6px",
                    }}
                  />
                  <span>{member.name}</span>
                  {member.robot && <AiBadge size="small" />}
                </Checkbox>
              ))}
            </CheckboxGroup>
          </div>
        </div>
      </div>
    </div>
  );

  const selectedList = selected.map((member) => (
    <div key={member.uid} className="opt-personnel-item">
      <div className="user-info">
        <WKAvatar
          src={member.avatar || avatarForUid(member.uid)}
          style={{ width: "24px", height: "24px", marginRight: "6px" }}
        />
        <span>{member.name}</span>
        {member.robot && <AiBadge size="small" />}
      </div>
      <div
        className="close-icon"
        onClick={() => actions.onToggleMember(member.uid)}
      >
        <span className="group-member-remove-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            focusable="false"
            aria-hidden="true"
          >
            <path
              d="M17.6568 19.7782C18.2426 20.3639 19.1924 20.3639 19.7782 19.7782C20.3639 19.1924 20.3639 18.2426 19.7782 17.6568L14.1213 12L19.7782 6.34313C20.3639 5.75734 20.3639 4.8076 19.7782 4.22181C19.1924 3.63602 18.2426 3.63602 17.6568 4.22181L12 9.87866L6.34313 4.22181C5.75734 3.63602 4.8076 3.63602 4.22181 4.22181L9.87866 12L4.22181 17.6568C3.63602 18.2426 3.63602 19.1924 4.22181 19.7782C4.8076 20.3639 5.75734 20.3639 6.34313 19.7782L12 14.1213L17.6568 19.7782Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </div>
    </div>
  ));

  if (mode === "createGroup") {
    return (
      <>
        {memberList}
        <div className="group-create-selected">
          <div className="organizational-group-new-right-title">
            {copy.selectedTitle}
          </div>
          <div className="organizational-group-new-right-body">
            {selectedList}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {memberList}
      <div className="wk-organizational-group-new-right">
        <div className="organizational-group-new-right-title">
          {copy.selectedTitle}
        </div>
        <div className="organizational-group-new-right-body">
          {selectedList}
        </div>
        <div className="organizational-group-new-right-footer">
          <Space spacing="medium">
            <Button style={{ width: 80 }} onClick={actions.onCancel}>
              {copy.cancel}
            </Button>
            <Button
              style={{ width: 80 }}
              className="wk-but-ok"
              theme="solid"
              type="primary"
              loading={false}
              onClick={actions.onConfirm}
            >
              {copy.confirm}
            </Button>
          </Space>
        </div>
      </div>
    </>
  );
}

export default GroupMemberPicker;
export { GroupMemberPicker };
export type { GroupMemberPickerProps } from "./types";
