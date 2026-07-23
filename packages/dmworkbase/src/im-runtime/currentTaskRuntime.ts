import WKSDK from "wukongimjssdk";

import {
  addImTaskListener,
  type ImTaskListener,
  type ImTaskRuntimeSdk,
} from "./taskRuntime";

function currentImRuntime() {
  return WKSDK.shared();
}

function currentImTaskRuntime<TTask>() {
  return currentImRuntime() as unknown as ImTaskRuntimeSdk<TTask>;
}

export function addCurrentImTaskListener<TTask>(
  listener: ImTaskListener<TTask>
) {
  addImTaskListener(currentImTaskRuntime<TTask>(), listener);
}
