import { createContext, useContext, useEffect } from "react";

/** Context stays live even for JSX retained inside the route queue. */
export const ChannelSettingActivityContext = createContext(true);

export function ChannelSettingActivityBinding(props: {
  onChange: (active: boolean) => void;
}) {
  const active = useContext(ChannelSettingActivityContext);
  useEffect(() => {
    props.onChange(active);
    return () => props.onChange(false);
  }, [active, props.onChange]);
  return null;
}
