import { config } from '../config';
import * as real from './real';
import * as mock from './mock';

export const api = config.USE_MOCK_API ? mock : real;
export const isMock = config.USE_MOCK_API;
