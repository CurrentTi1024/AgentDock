import { messageFeedbackMockData } from '@/mock-data/messageFeedback';
import { mockDelay } from '@/services/core/mock';
import { postApi } from '@/services/core/httpClient';
import { selectService } from '@/services/core/serviceMode';
import type { ServiceRequestOptions } from '@/services/core/types';
export type MessageFeedback = 'dislike' | 'like' | 'none';
export interface FeedbackRequest { feedback: MessageFeedback; messageId: string; reasonCode?: string; reasonText?: string; runId: string; sessionId: string; threadId: string }
export interface FeedbackResult { feedback: MessageFeedback; feedbackId: string; messageId: string; updatedAt: string }
export interface MessageFeedbackService { submitMessageFeedback(input: FeedbackRequest, options?: ServiceRequestOptions): Promise<FeedbackResult> }
export const messageFeedbackHttpService: MessageFeedbackService = { submitMessageFeedback: (input, options) => postApi('submitMessageFeedback', input, options) };
export const messageFeedbackMockService: MessageFeedbackService = { submitMessageFeedback: async (input, options) => { await mockDelay(options?.signal); if (input.feedback === 'none') messageFeedbackMockData.delete(input.messageId); else messageFeedbackMockData.set(input.messageId, input.feedback); return { feedbackId: `feedback-${input.messageId}`, messageId: input.messageId, feedback: input.feedback, updatedAt: new Date().toISOString() }; } };
export const messageFeedbackService = selectService(messageFeedbackHttpService, messageFeedbackMockService);
