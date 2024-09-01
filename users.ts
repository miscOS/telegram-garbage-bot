import AppError from "./errors";

import fs from 'fs';
import { DateTime } from "luxon";
import path from 'path';

export class UserManager {

    private users: User[] = [];

    constructor(
        private TZ: string = 'Europe/Berlin',    
        private userfile: string = path.join(__dirname, '..', 'data', 'users.json'),
    ) {
        this.load();
    }

    load() {
        try {
            const jsonContent = fs.readFileSync(this.userfile, 'utf-8');
            const jsonData = JSON.parse(jsonContent);

            this.users = jsonData.map( (userData: User) => {
                const user = new User(userData.id, userData.city, userData.street, userData.streetNumber, userData.location, userData.cronTime, userData.timezone);
                user.events.onChange(this.save.bind(this));
                return user;
            });
        } catch (error) {
            console.error(`failed to load user:`, error);
        }
    }

    save() {
        try {
            const jsonString = JSON.stringify(this.users, (key, value) => {
                if (key === 'events') {
                    return undefined;
                }
                return value;
            })
            fs.writeFileSync(this.userfile, jsonString, 'utf-8');
        } catch (error) {
            console.error(`failed to save user:`, error);
            throw error;
        }
    }

    addUser(id: number) {
        if (this.users.some((user) => user.id === id)) {
            throw new AppError('UserAlreadyExistsExcpetion', 'cannot create a new user with this id');
        }

        const user: User = new User(id);
        user.timezone = this.TZ;
        user.events.onChange(this.save.bind(this));
        this.users.push(user);
        this.save();
    }

    deleteUser(id: number) {
        if (this.users.some((user) => user.id === id)) {
            throw new AppError('UserAlreadyExistsExcpetion', 'cannot create a new user with this id');
        }

        this.users = this.users.filter(user => user.id !== id);
        this.save();
    }

    getAllUsers(): User[] {
        return this.users;
    }

    getUser(id: number): User {
        const user: User = this.users.find(user => user.id === id);

        if(!user) {
            throw new AppError('UserDoesNotExistsExcpetion', 'user is not registered');
        }
        return user;
    }
}


export class User {
  
    constructor(
        public id: number,
        public city?: string,
        public street?: string,
        public streetNumber?: string,
        public location?: number,
        public cronTime?: string,
        public timezone: string = 'Europe/Berlin',
        public events: UserEvents = new UserEvents
    ) {}

    removeCron() {
        this.cronTime = undefined;
        this.events.changed();
    }

    setCron(payload: string, cronStep: number): [number, number] {
        let [hour, minute] = this.parseCronTime(payload, cronStep);
        if (hour < 0 || hour > 24 || minute < 0 || minute > 59){
            throw new AppError('InvalidChronArgumentExcpetion', 'hour needs to be an integer between 0 and 24, minute needs to be an integer between 0 and 59.');
        }
        
        this.cronTime = DateTime.utc().setZone(this.timezone).set({ hour, minute, second: 0, millisecond: 0 }).toISO();
        this.events.changed();

        return [hour, minute];
    }

    private parseCronTime(payload: string, cronStep: number): [number, number] {
        let [hour, minute] = payload.split(':').map(Number);

        if (!Number.isInteger(hour) || !Number.isInteger(minute) ||hour < 0 || hour > 24 || minute < 0 || minute > 59) {
            throw new AppError('InvalidChronArgumentExcpetion', 'hour needs to be an integer between 0 and 24, minute needs to be an integer between 0 and 59.');
        }

        // Limit CronTime to CronSteps
        if (minute % cronStep > Math.floor(cronStep / 2)) {
            minute += cronStep - minute % cronStep;
        } else {
            minute -= minute % cronStep;
        }

        // Respect Minute Limit
        if (minute >= 60) {
            minute -= 60;
            hour += 1;
        }

        return [hour, minute];
    }
}


class UserEvents {

    constructor(
        private onChangeCallbacks: Function[] = []
    ) {}

    onChange(callback: Function) {
        this.onChangeCallbacks.push(callback);
    }

    changed(data?: any) {
        this.onChangeCallbacks.forEach(callback => callback(data));
    }
}