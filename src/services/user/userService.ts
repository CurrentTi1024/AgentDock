import { currentUserProfileMockData } from '@/mock-data/user';
import { mockDelay } from '@/services/core/mock';
import { postApi } from '@/services/core/httpClient';
import { selectService } from '@/services/core/serviceMode';
import type { ServiceRequestOptions } from '@/services/core/types';
export type CurrentUserProfile = typeof currentUserProfileMockData;
export interface UserService { getCurrentUserProfile(options?: ServiceRequestOptions): Promise<CurrentUserProfile> }
export const userHttpService: UserService = { getCurrentUserProfile: (options) => postApi('getCurrentUserProfile', {}, options) };
export const userMockService: UserService = { getCurrentUserProfile: async (options) => { await mockDelay(options?.signal); return structuredClone(currentUserProfileMockData); } };
export const userService = selectService(userHttpService, userMockService);
