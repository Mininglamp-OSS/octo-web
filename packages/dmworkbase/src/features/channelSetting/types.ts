import RouteContext from "../../Service/Context";

export type ChannelSettingTextEditPush = (
  context: RouteContext<any>,
  defaultValue: string,
  onFinish: (value: string) => Promise<void>,
  placeholder?: string,
  maxCount?: number,
  allowEmpty?: boolean,
  allowWrap?: boolean
) => void;
