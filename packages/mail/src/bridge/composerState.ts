export interface ComposerFieldState {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachments: string;
}

export function hasComposerChanges(
  current: ComposerFieldState,
  initial: ComposerFieldState
): boolean {
  return (
    current.to !== initial.to ||
    current.cc !== initial.cc ||
    current.bcc !== initial.bcc ||
    current.subject !== initial.subject ||
    current.body !== initial.body ||
    current.attachments !== initial.attachments
  );
}
