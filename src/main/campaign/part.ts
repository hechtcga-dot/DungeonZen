import type { Campaign } from './campaign'

/** One area of Campaign's methods in a file of its own (timeline.ts, live.ts…); campaign.ts puts it on Campaign. */
export const part = <T>(methods: T & ThisType<Campaign>): T => methods
