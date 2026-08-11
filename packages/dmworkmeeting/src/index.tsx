export { MeetingModule } from './module';
export { MeetingApiClient } from './service/MeetingApiClient';
export { MeetingErrorCode, MEETING_ERROR_TABLE, directiveForCode } from './service/errors';
export { evaluateAdmission } from './logic/admission';
export type { Meeting, Participant } from './service/contracts';
