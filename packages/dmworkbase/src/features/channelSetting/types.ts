import RouteContext from "../../Service/Context";

export type ChannelSettingInputEditPush = (
  context: RouteContext<any>,
  defaultValue: string,
  onFinish: (value: string) => Promise<void>,
  placeholder?: string,
  maxCount?: number,
  allowEmpty?: boolean,
  allowWrap?: boolean
) => void;
