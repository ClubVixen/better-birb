// src/stores/random-message.store.ts
import { observable, computed, action } from 'mobx';
import socket from '../utils/websocket';
import { RandomMessage, RandomMessageEvent, Events } from 'postybirb-commons'; 
import RandomMessageService from '../services/random-message.service';

export interface RandomMessageState {
  messages: RandomMessage[];
}

export class RandomMessageStore {
  @observable state: RandomMessageState = {
    messages: []
  };

  constructor() {
    // Load initial data from server
    RandomMessageService.getAll()
      .then(({ data }) => {
        this.state.messages.push(...data.sort((a, b) => a.title.localeCompare(b.title)));
      })
      .catch(() => {
        // handle error or ignore
      });

    // Listen for socket events
    socket.on(Events.RandomMessageEvent.CREATED, (created: RandomMessage) => {
      this.addOrUpdate(created);
    });
    socket.on(Events.RandomMessageEvent.UPDATED, (updated: RandomMessage) => {
      this.addOrUpdate(updated);
    });
    socket.on(Events.RandomMessageEvent.REMOVED, (id: string) => {
      this.remove(id);
    });
  }

  @computed
  get messages() {
    return this.state.messages;
  }

  @action
  addOrUpdate(msg: RandomMessage) {
    const index = this.state.messages.findIndex((m) => m._id === msg._id);
    if (index === -1) {
      this.state.messages.push(msg);
    } else {
      this.state.messages[index] = msg;
    }
  }

  @action
  remove(id: string) {
    const index = this.state.messages.findIndex((m) => m._id === id);
    if (index >= 0) {
      this.state.messages.splice(index, 1);
    }
  }
}

// Create a single store instance
export const randomMessageStore = new RandomMessageStore();
