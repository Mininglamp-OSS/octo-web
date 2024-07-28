import { Checkbox } from "@douyinfe/semi-ui";
import React, { Component } from "react";
import { getPinyin } from "../../Utils/pinYin";
import { toSimplized } from "../../Utils/t2s";
import { IconSearchStroked } from "@douyinfe/semi-icons";
import { animateScroll, scroller } from "react-scroll";

import "./index.css";

export class IndexTableItem {
  id!: string;
  name!: string;
  avatar!: string;

  constructor(id: string, name: string, avatar: string) {
    this.id = id;
    this.name = name;
    this.avatar = avatar;
  }
}

export class IndexTableProps {
  items!: IndexTableItem[];
  canSelect?: boolean;
  onSelect?: (items: IndexTableItem[]) => void;
  disableSelectList?: string[]; // 禁选列表
}

export class IndexTableState {
  indexList: string[] = [];
  indexItemMap: Map<string, IndexTableItem[]> = new Map();
  selectedList: IndexTableItem[] = [];
}

export default class IndexTable extends Component<
  IndexTableProps,
  IndexTableState
> {
  constructor(props: IndexTableProps) {
    super(props);
    this.state = {
      indexList: [],
      indexItemMap: new Map(),
      selectedList: [],
    };
  }
  componentDidMount() {
    const { items } = this.props;
    this.buildIndex(items);
  }

  buildIndex(items: IndexTableItem[]) {
    const indexItemMap = new Map<string, IndexTableItem[]>();
    let indexList = new Array<string>();
    for (const item of items) {
      let pinyinNick = getPinyin(toSimplized(item.name)).toUpperCase();
      let indexName =
        !pinyinNick || /[^a-z]/i.test(pinyinNick[0]) ? "#" : pinyinNick[0];

      let existItems = indexItemMap.get(indexName);
      if (!existItems) {
        existItems = [];
        indexList.push(indexName);
      }
      existItems.push(item);
      indexItemMap.set(indexName, existItems);
    }
    indexList = indexList.sort((a, b) => {
      if (a === "#") {
        return -1;
      }
      if (b === "#") {
        return 1;
      }
      return a.localeCompare(b);
    });
    this.setState({
      indexList: indexList,
      indexItemMap: indexItemMap,
    });
  }

  onSearch(v: string) {
    const { items } = this.props;
    this.buildIndex(
      items.filter((item) => {
        return item.name.toLowerCase().indexOf(v.toLowerCase()) !== -1;
      })
    );
  }

  checkItem(item: IndexTableItem) {
    const { selectedList } = this.state;
    const { onSelect } = this.props;
    let newSelectedList = selectedList;
    let found = -1;
    for (let index = 0; index < newSelectedList.length; index++) {
      const selected = newSelectedList[index];
      if (selected.id === item.id) {
        found = index;
        break;
      }
    }
    if (found >= 0) {
      newSelectedList.splice(found, 1);
    } else {
      newSelectedList = [item, ...selectedList];
    }

    this.setState({
      selectedList: newSelectedList,
    });
    if (onSelect) {
      onSelect(newSelectedList);
    }
  }
  isCheckItem(item: IndexTableItem) {
    const { selectedList } = this.state;
    for (const selected of selectedList) {
      if (selected.id === item.id) {
        return true;
      }
    }
    return false;
  }

  isDisableItem(id: string) {
    const { disableSelectList } = this.props;
    if (disableSelectList && disableSelectList.length > 0) {
      for (const disableSelect of disableSelectList) {
        if (disableSelect === id) {
          return true;
        }
      }
    }
    return false;
  }

  sectionUI(indexName: string) {
    const { indexItemMap } = this.state;
    const { canSelect, onSelect } = this.props;
    const items = indexItemMap.get(indexName);
    return (
      <div key={indexName} className="wk-indextable-section">
        <div className="wk-indextable-list">
          {items?.map((item, i) => {
            return (
              <div
                key={item.id}
                className="wk-indextable-item"
                onClick={() => {
                  if (canSelect && !this.isDisableItem(item.id)) {
                    this.checkItem(item);
                    this.setState({}, () => {
                      this.scrollToTop();
                    });
                  } else {
                    if (onSelect) {
                      onSelect([item]);
                    }
                  }
                }}
              >
                <div className="wk-indextable-item-index">
                  {i === 0 ? indexName : ""}
                </div>
                {canSelect ? (
                  <div className="wk-indextable-checkbox">
                    <Checkbox
                      checked={
                        this.isDisableItem(item.id) || this.isCheckItem(item)
                      }
                      disabled={this.isDisableItem(item.id)}
                    ></Checkbox>
                  </div>
                ) : undefined}
                <div className="wk-indextable-item-avatar">
                  <img src={item.avatar} alt=""></img>
                </div>
                <div className="wk-indextable-item-name">{item.name}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  getSelectedUsers() {
    const { selectedList } = this.state;
    return selectedList;
  }

  // 只滚动到底部
  scrollToTop(): void {
    const scroller = document.getElementById("selectedList");
    scroller?.scrollTo(0, 0);
  }

  render() {
    const { indexList } = this.state;
    return (
      <div className="wk-indextable">
        <div className="wk-indextable-search">
          <div className="wk-indextable-selected-box" id="selectedList">
            {this.getSelectedUsers().map((item) => {
              return (
                <div
                  key={item.id}
                  className="wk-indextable-select-user"
                  onClick={() => {
                    if (!this.isDisableItem(item.id)) {
                      this.checkItem(item);
                    }
                  }}
                >
                  <img
                    src={item.avatar}
                    style={{ width: "50px", height: "50px" }}
                    alt=""
                  />
                </div>
              );
            })}
          </div>
          <div className="wk-indextable-search-box">
            <div className="wk-indextable-search-icon">
              <IconSearchStroked
                style={{ color: "#bbbfc4", fontSize: "20px" }}
              />
            </div>
            <div className="wk-indextable-search-input">
              <input
                onChange={(v) => {
                  this.onSearch(v.target.value);
                }}
                placeholder={"搜索"}
                ref={(rf) => {}}
                type="text"
                style={{ fontSize: "17px" }}
              />
            </div>
          </div>
        </div>
        <div className="wk-indextable-contacts">
          {indexList.map((indexName) => {
            return this.sectionUI(indexName);
          })}
        </div>
      </div>
    );
  }
}
