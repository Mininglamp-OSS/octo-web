import React from "react";
import { Component, ReactNode } from "react";

import {
  Modal,
  Button,
  Space,
  Tree,
  Input,
  CheckboxGroup,
  Checkbox,
  Toast,
} from "@douyinfe/semi-ui";
import { BasicTreeNodeData } from "@douyinfe/semi-foundation/lib/cjs/tree/foundation";
import { WKApp, ThemeMode, WKViewQueueHeader } from "@tsdaodao/base";
import WKAvatar from "@tsdaodao/base/src/Components/WKAvatar";
import { ContactsStatus } from "@tsdaodao/base/src/Service/DataSource/DataSource";

import "./index.css";

interface IPorpsOrganizationalGroupNew {
  channel: {
    channelID: string;
    channelType: number;
  };
  disableSelectList?: string[];
  showAdd?: boolean;
  render?: JSX.Element;
  remove?: () => void;
}

interface ISateOrganizationalGroupNew {
  showModal: boolean;
  optTitle: string;
  organizationInfo: {
    name: string;
    is_upload_logo?: number;
    org_id?: string;
    short_no?: string;
  };
  treeData: any[];
  optPersonnelData: any[];
  isFriend: boolean;
  friendData: any[];
  friendSearchData: any[];
  searchVaule: string;
}

export class OrganizationalGroupNew extends Component<
  IPorpsOrganizationalGroupNew,
  ISateOrganizationalGroupNew
> {
  state: ISateOrganizationalGroupNew = {
    showModal: false,
    optTitle: "",
    organizationInfo: {
      name: "",
    },
    treeData: [],
    optPersonnelData: [],
    isFriend: true,
    friendData: [],
    friendSearchData: [],
    searchVaule: "",
  };
  treeRef: any = React.createRef();

  constructor(props: IPorpsOrganizationalGroupNew) {
    super(props);
  }

  componentDidMount(): void {
    this.getFriendData();
  }

  // 获取加入公司
  async getJoinOrganization() {
    const res = await WKApp.apiClient.get("/organization/joined");
    if (res && res.length > 0) {
      const organizationInfo = res[0];
      this.setState({
        organizationInfo: organizationInfo,
      });
      if (organizationInfo) {
        this.getOrganizationDepartment(organizationInfo.org_id);
      }
    }
  }
  // 获取加入公司所有部门
  async getOrganizationDepartment(org_id: string) {
    const res = await WKApp.apiClient.get(
      `/organizations/${org_id}/department`
    );
    // 部门
    const departments: any = this.handleTree(res.departments);
    // 人员
    const employees: any[] = [];
    res.employees.map((y: any) => {
      employees.push({
        label: y.employee_name,
        value: y.employee_id,
        key: `uid_${y.uid}`,
        icon: (
          <WKAvatar
            src={WKApp.shared.avatarUser(y.uid as string)}
            style={{ width: "20px", height: "20px", marginRight: "6px" }}
          />
        ),
        is_employee: true,
        ...y,
      });
    });
    this.setState({
      treeData: [...departments, ...employees],
    });
  }
  // 处理全部子部门人数
  handelEmployeesNum(arr: any[]) {
    let employeesNums: number[] = [];
    arr.map((item) => {
      if (item.employees && item.employees.length > 0) {
        employeesNums.push(item.employees.length);
      }
      if (item.children && item.children.length > 0) {
        const employeesNum = this.handelEmployeesNum(item.children);
        employeesNums = [...employeesNums, ...employeesNum];
      }
    });
    return employeesNums;
  }

  handleTree(arr: any[]) {
    const OTree: any = [];
    arr.map((item: any) => {
      let children: any[] = [];
      let employeesNum: number = 0;
      // 获取当前部门人数
      if (item.employees) {
        employeesNum = parseInt(item.employees.length);
      }
      // 获取全部子部门人数
      if (item.children) {
        const employeesNums = this.handelEmployeesNum(item.children);
        employeesNums.map((num) => {
          employeesNum += num;
        });
      }
      // 有组织和人员
      if (item.children && item.employees) {
        children = this.handleTree(item.children);
        const employees: any[] = [];
        item.employees.map((y: any) => {
          employees.push({
            label: y.employee_name,
            value: y.employee_id,
            key: `${item.dept_id}_${y.employee_id}`,
            icon: (
              <WKAvatar
                src={WKApp.shared.avatarUser(y.uid as string)}
                style={{ width: "24px", height: "24px", marginRight: "6px" }}
              />
            ),
            is_employee: true,
            ...y,
          });
        });
        children = [...children, ...employees];
      }
      // 只有人员
      if (!item.children && item.employees) {
        const employees: any[] = [];
        item.employees.map((y: any) => {
          employees.push({
            label: y.employee_name,
            value: y.employee_id,
            key: `${item.dept_id}_${y.employee_id}`,
            icon: (
              <WKAvatar
                src={WKApp.shared.avatarUser(y.uid as string)}
                style={{ width: "20px", height: "20px", marginRight: "6px" }}
              />
            ),
            is_employee: true,
            ...y,
          });
        });
        children = [...children, ...employees];
      }

      OTree.push({
        label:
          employeesNum > 0 ? `${item.name}(${employeesNum})` : `${item.name}`,
        value: item.dept_id,
        key: item.short_no,
        icon: (
          <span
            className="department-icon"
            style={{ display: "flex", marginRight: "6px" }}
          >
            <svg
              width="24px"
              height="18px"
              viewBox="0 0 24 18"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g
                id="页面-1"
                stroke="none"
                strokeWidth="1"
                fill="none"
                fillRule="evenodd"
              >
                <g
                  id="02"
                  transform="translate(-98.000000, -131.000000)"
                  fill="currentColor"
                  fillRule="nonzero"
                >
                  <g
                    id="wenjianjia"
                    transform="translate(98.000000, 131.000000)"
                  >
                    <path
                      d="M21.343573,4.88046647 C21.6937698,4.9154519 22.0439666,5.00291545 22.3941634,5.14285714 C22.7443602,5.28279883 23.0484784,5.47959184 23.3065182,5.73323615 C23.5645579,5.98688047 23.7580877,6.30612245 23.8871076,6.6909621 C24.0161275,7.07580175 24.0345589,7.5393586 23.9424018,8.08163265 C23.905539,8.22157434 23.8318134,8.56705539 23.7212249,9.1180758 C23.6106365,9.66909621 23.4816166,10.303207 23.3341653,11.0204082 C23.186714,11.7376093 23.0208313,12.4766764 22.8365172,13.2376093 C22.6522031,13.9985423 22.4771047,14.6501458 22.311222,15.1924198 C22.219065,15.5072886 22.0854373,15.8309038 21.9103389,16.1632653 C21.7352405,16.4956268 21.5094557,16.7973761 21.2329845,17.0685131 C20.9565134,17.3396501 20.624748,17.5626822 20.2376884,17.7376093 C19.8506288,17.9125364 19.3898435,18 18.8553326,18 L3.53883076,18 C3.15177114,18 2.75088797,17.9212828 2.33618124,17.7638484 C1.92147451,17.606414 1.53902275,17.3833819 1.18882596,17.0947522 C0.838629164,16.8061224 0.552942306,16.4562682 0.331765384,16.0451895 C0.110588461,15.6341108 0,15.1749271 0,14.6676385 L0,3.41107872 C0,2.34402332 0.304118268,1.50874636 0.912354805,0.905247813 C1.52059134,0.301749271 2.37765192,0 3.48353653,0 L17.0859173,0 C17.4914083,0 17.9107229,0.0743440233 18.343861,0.22303207 C18.7769991,0.371720117 19.1686666,0.577259475 19.5188634,0.839650146 C19.8690602,1.10204082 20.154747,1.40816327 20.375924,1.75801749 C20.5971009,2.10787172 20.7076894,2.48396501 20.7076894,2.88629738 L20.7076894,3.17492711 L19.2700394,3.17492711 C18.532783,3.17492711 17.6711145,3.17055394 16.6850341,3.16180758 C15.6989536,3.15306122 14.6483633,3.14868805 13.5332629,3.14868805 C12.4181626,3.14868805 11.3767879,3.14431487 10.4091389,3.13556851 C9.44148987,3.12682216 8.60746856,3.12244898 7.90707497,3.12244898 L6.63530767,3.12244898 C6.15609101,3.12244898 5.78285495,3.26676385 5.5155995,3.55539359 C5.24834405,3.84402332 5.04099069,4.2244898 4.89353941,4.696793 C4.74608813,5.20408163 4.58020543,5.74198251 4.39589133,6.31049563 C4.21157723,6.87900875 4.04569454,7.40816327 3.89824326,7.89795918 C3.71392915,8.47521866 3.52961505,9.03498542 3.34530095,9.57725948 C3.30843813,9.71720117 3.29000672,9.83090379 3.29000672,9.91836735 C3.29000672,10.2157434 3.39598733,10.4650146 3.60794855,10.6661808 C3.81990976,10.8673469 4.08255736,10.96793 4.39589133,10.96793 C4.96726505,10.96793 5.35432466,10.6268222 5.55707017,9.94460641 L7.02236728,4.85422741 C9.41845061,4.87172012 11.6117884,4.88046647 13.6023807,4.88046647 L21.343573,4.88046647 L21.343573,4.88046647 Z"
                      id="路径"
                    ></path>
                  </g>
                </g>
              </g>
            </svg>
          </span>
        ),
        dept_id: item.dept_id,
        org_id: item.org_id,
        name: item.name,
        is_department: true,
        children: children,
      });
    });
    return OTree;
  }

  onSelectOrganization(
    selectedKey: string,
    selected: boolean,
    selectedNode: BasicTreeNodeData
  ) {
    if (selected) {
      const getOptTreeData = [];
      getOptTreeData.push(selectedNode);

      const newOptTreeData = [
        ...this.state.optPersonnelData,
        ...this.handOptTree(getOptTreeData),
      ];
      // 处理去重
      const uniqueArr = Object.values(
        newOptTreeData.reduce((acc, curr) => {
          acc[curr.uid] = curr;
          return acc;
        }, {})
      );
      this.setState({
        optPersonnelData: [...uniqueArr],
      });
    }
  }

  handOptTree(arr: any[]) {
    let OTree: any = [];
    arr.map((item: any) => {
      if (item.children && item.is_department) {
        const res = this.handOptTree(item.children);
        OTree = [...OTree, ...res];
      }
      if (item.is_employee) {
        OTree.push({
          name: item.employee_name,
          uid: item.uid,
        });
      }
    });
    return OTree;
  }

  onDelOptPersonnel(uid: string) {
    const newOpt = this.state.optPersonnelData.filter((item) => {
      return item.uid !== uid;
    });
    this.setState({
      optPersonnelData: [...newOpt],
    });
  }

  getFriendData() {
    const setFriendData: any[] = [];
    WKApp.dataSource.contactsList
      .filter((c) => c.status !== ContactsStatus.Blacklist)
      .map((item) => {
        setFriendData.push({
          name: item.remark || item.name,
          uid: item.uid,
        });
      });
    this.setState({
      friendData: [...setFriendData],
      friendSearchData: [...setFriendData],
    });
  }

  onFriendChange(value: string[]) {
    const getFriendOpt: any[] = [];
    const { friendData, optPersonnelData } = this.state;
    value.map((i) => {
      friendData.map((y) => {
        if (i == y.uid) {
          getFriendOpt.push(y);
        }
      });
    });

    const newPersonnelData = [...getFriendOpt, ...optPersonnelData];

    // 处理去重
    const uniqueArr = Object.values(
      newPersonnelData.reduce((acc, curr) => {
        acc[curr.uid] = curr;
        return acc;
      }, {})
    );
    this.setState({
      optPersonnelData: [...uniqueArr],
    });
  }

  onOrginzational() {
    this.setState({
      isFriend: false,
      searchVaule: "",
    });
  }

  onShowModal() {
    const { channelType } = this.props.channel;
    this.getJoinOrganization();
    this.setState({
      showModal: true,
      optTitle: channelType === 1 ? "创建群" : "请选择联系人",
    });
  }

  onCancel() {
    this.setState({
      showModal: false,
      isFriend: true,
      optPersonnelData: [],
    });
    this.props.remove && this.props.remove();
  }

  async onOK() {
    const channel = this.props.channel as any;
    const { optPersonnelData } = this.state;
    if (optPersonnelData.length == 0) {
      return Toast.warning("请选择联系人");
    }

    const getOptPersonnelData = optPersonnelData.map((item) => {
      return item.uid;
    });

    // 创建群
    if (channel.channelType == 1) {
      await WKApp.dataSource.channelDataSource.createChannel([
        ...getOptPersonnelData,
        channel.channelID,
      ]);
    }
    // 添加联系人
    if (channel.channelType == 2) {
      await WKApp.dataSource.channelDataSource.addSubscribers(
        channel,
        getOptPersonnelData
      );
    }
    this.onCancel();
  }

  onChangeSearch(value: string) {
    const { friendSearchData, isFriend } = this.state;

    if (isFriend) {
      this.setState({
        searchVaule: value,
        friendData: friendSearchData.filter((item) => {
          return item.name.toLowerCase().indexOf(value.toLowerCase()) !== -1;
        }),
      });
    }
    if (!isFriend) {
      this.setState({
        searchVaule: value,
      });
      console.log(this.treeRef);
      this.treeRef && this.treeRef.current.search(value);
    }
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

  render(): ReactNode {
    const isDark = WKApp.config.themeMode === ThemeMode.dark;
    const {
      showModal,
      treeData,
      optTitle,
      optPersonnelData,
      organizationInfo,
      isFriend,
      friendData,
      searchVaule,
    } = this.state;
    const { showAdd, render } = this.props;
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {showAdd && (
          <div
            onClick={() => {
              this.onShowModal();
            }}
          >
            <svg
              viewBox="0 0 22 22"
              fill={WKApp.config.themeColor}
              width="20px"
              height="20px"
              focusable="false"
              aria-hidden="true"
            >
              <g clipPath="url(#clip_user_add)">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M19.0796 19.8369C17.7027 17.6014 14.7559 15.5 10.4593 15.5C6.16267 15.5 3.21588 17.6014 1.83892 19.8369C1.19533 20.8817 2.10818 22 3.33535 22H17.5832C18.8104 22 19.7232 20.8817 19.0796 19.8369Z"
                ></path>
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M14.0499 10.4204C14.5723 10.2065 15.0693 9.55774 15.2962 8.71085C15.5913 7.60959 15.5327 6.62629 14.7285 6.3203C14.6504 2.48444 13.1369 1 9.96023 1C6.7838 1 5.27021 2.48424 5.19199 6.31952C4.38589 6.62467 4.32701 7.60866 4.62233 8.7108C4.84958 9.55892 5.34768 10.2083 5.87087 10.4213C6.71146 12.5727 8.24123 14.013 9.96023 14.013C11.6795 14.013 13.2094 12.5723 14.0499 10.4204Z"
                ></path>
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M20 1C19.4478 1 19 1.44772 19 2V4H17C16.4478 4 16 4.44772 16 5C16 5.55228 16.4478 6 17 6H19V8C19 8.55228 19.4478 9 20 9C20.5523 9 21 8.55228 21 8V6H23C23.5523 6 24 5.55228 24 5C24 4.44772 23.5523 4 23 4H21V2C21 1.44772 20.5523 1 20 1Z"
                ></path>
              </g>
              <defs>
                <clipPath id="clip_user_add">
                  <rect width="24" height="24" fill="currentColor"></rect>
                </clipPath>
              </defs>
            </svg>
            <div className="wk-conversation-header-mask"></div>
          </div>
        )}

        {render && (
          <div
            onClick={() => {
              this.onShowModal();
            }}
          >
            {render}
          </div>
        )}

        <Modal
          width={640}
          className="wk-main-modal-organizational-group-new"
          footer={null}
          closeIcon={<div></div>}
          visible={showModal}
          centered
          maskClosable={false}
          onCancel={() => {
            this.onCancel();
          }}
        >
          <div className="wk-organizational-group-new-left">
            <div className="group-new-left-search">
              <Input
                className="group-new-left-search-input"
                placeholder="搜索"
                value={searchVaule}
                showClear
                onChange={(value) => {
                  this.onChangeSearch(value);
                }}
              />
            </div>
            <div className="group-new-left-main">
              {isFriend ? (
                <div className="friend-opt">
                  {/* 组织架构 */}
                  {organizationInfo?.org_id && (
                    <div
                      className="organization-name"
                      onClick={() => {
                        this.onOrginzational();
                      }}
                    >
                      <img
                        style={{
                          width: "24px",
                          height: "24px",
                          marginRight: "6px",
                        }}
                        src={require("../../assets/organizational_new.png")}
                        alt=""
                      />
                      <span>{organizationInfo?.name}</span>
                    </div>
                  )}

                  <div className="friend-opt-main">
                    <CheckboxGroup
                      style={{ width: "100%" }}
                      onChange={(value) => {
                        this.onFriendChange(value);
                      }}
                    >
                      {friendData.map((friend) => {
                        return (
                          <Checkbox
                            key={friend.uid}
                            value={friend.uid}
                            disabled={this.isDisableItem(friend.uid)}
                            className="friend-opt-item"
                          >
                            <WKAvatar
                              src={WKApp.shared.avatarUser(
                                friend.uid as string
                              )}
                              style={{
                                width: "24px",
                                height: "24px",
                                marginRight: "6px",
                              }}
                            />
                            <span>{friend.name}</span>
                          </Checkbox>
                        );
                      })}
                    </CheckboxGroup>
                  </div>
                </div>
              ) : (
                <div className="organizational-opt">
                  <div className="organizational-opt-header">
                    <WKViewQueueHeader
                      title={organizationInfo.name}
                      onBack={() => {
                        this.setState({
                          isFriend: true,
                          searchVaule: "",
                        });
                      }}
                    />
                  </div>
                  <div className="organizational-opt-main">
                    <Tree
                      ref={this.treeRef}
                      treeData={treeData}
                      filterTreeNode
                      searchRender={false}
                      multiple
                      showFilteredOnly={true}
                      className="organizational-tree"
                      onSelect={(
                        selectedKey: string,
                        selected: boolean,
                        selectedNode: BasicTreeNodeData
                      ) => {
                        this.onSelectOrganization(
                          selectedKey,
                          selected,
                          selectedNode
                        );
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="wk-organizational-group-new-right">
            <div className="organizational-group-new-right-title">
              {optTitle}
            </div>
            <div className="organizational-group-new-right-body">
              {optPersonnelData &&
                optPersonnelData.map((item, index) => {
                  return (
                    <div key={item.uid} className="opt-personnel-item">
                      <div className="user-info">
                        <WKAvatar
                          src={WKApp.shared.avatarUser(item.uid as string)}
                          style={{
                            width: "24px",
                            height: "24px",
                            marginRight: "6px",
                          }}
                        />
                        <span>{item.name}</span>
                      </div>
                      <div
                        className="close-icon"
                        onClick={() => {
                          this.onDelOptPersonnel(item.uid);
                        }}
                      >
                        <span className="semi-icon semi-icon-default semi-icon-close">
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
                              d="M17.6568 19.7782C18.2426 20.3639 19.1924 20.3639 19.7782 19.7782C20.3639 19.1924 20.3639 18.2426 19.7782 17.6568L14.1213 12L19.7782 6.34313C20.3639 5.75734 20.3639 4.8076 19.7782 4.22181C19.1924 3.63602 18.2426 3.63602 17.6568 4.22181L12 9.87866L6.34313 4.22181C5.75734 3.63602 4.8076 3.63602 4.22181 4.22181C3.63602 4.8076 3.63602 5.75734 4.22181 6.34313L9.87866 12L4.22181 17.6568C3.63602 18.2426 3.63602 19.1924 4.22181 19.7782C4.8076 20.3639 5.75734 20.3639 6.34313 19.7782L12 14.1213L17.6568 19.7782Z"
                              fill="currentColor"
                            ></path>
                          </svg>
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="organizational-group-new-right-footer">
              <Space spacing="medium">
                <Button
                  style={{ width: 80 }}
                  onClick={() => {
                    this.onCancel();
                  }}
                >
                  取消
                </Button>
                <Button
                  style={{ width: 80 }}
                  className="wk-but-ok"
                  theme="solid"
                  type="primary"
                  onClick={() => {
                    this.onOK();
                  }}
                >
                  确定
                </Button>
              </Space>
            </div>
          </div>
        </Modal>
      </div>
    );
  }
}
