// postybirb-commons/src/interfaces/random-message/random-message.interface.ts

import { EntityIntf } from '../database/entity.interface';

/**
 * The shape of a single RandomMessage "set"
 */
export interface RandomMessage extends EntityIntf {
  title: string;
  messages: string[];
  description?: string;
}
