export type ImTaskListener<TTask = unknown> = (task: TTask) => void;

export interface ImTaskRuntimeSdk<TTask = unknown> {
  taskManager: {
    addListener: (listener: ImTaskListener<TTask>) => void;
  };
}

export function addImTaskListener<TTask>(
  sdk: ImTaskRuntimeSdk<TTask>,
  listener: ImTaskListener<TTask>
) {
  sdk.taskManager.addListener(listener);
}
