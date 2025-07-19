// random-message.service.ts
import axios from '../utils/http';
import { AxiosResponse } from 'axios';
import { RandomMessage } from 'postybirb-commons'; // use the same interface

export default class RandomMessageService {
  static getAll(): Promise<AxiosResponse<RandomMessage[]>> {
    return axios.get('/random-message');
  }

  static create(dto: Partial<RandomMessage>): Promise<AxiosResponse<RandomMessage>> {
    return axios.post('/random-message/create', dto);
  }

  static update(dto: Partial<RandomMessage>): Promise<AxiosResponse<RandomMessage>> {
    return axios.patch('/random-message/update', dto);
  }

  static remove(id: string): Promise<AxiosResponse<any>> {
    return axios.delete(`/random-message/${id}`);
  }
}
