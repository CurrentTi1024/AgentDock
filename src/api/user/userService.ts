import { currentUserProfileMockData } from '@/mock-data/user';
import { mockDelay } from '@/lib/mock';
import { postApi } from '@/lib/httpClient';
import { selectService } from '@/api/core/serviceMode';
import type { ServiceRequestOptions } from '@/api/core/types';
export type CurrentUserProfile = typeof currentUserProfileMockData;
export interface UserService { getCurrentUserProfile(options?: ServiceRequestOptions): Promise<CurrentUserProfile> }
export const userHttpService: UserService = { getCurrentUserProfile: (options) => postApi('getCurrentUserProfile', {}, options) };
export const userMockService: UserService = { getCurrentUserProfile: async (options) => { await mockDelay(options?.signal); return structuredClone(currentUserProfileMockData); } };
export const userService = selectService(userHttpService, userMockService);
