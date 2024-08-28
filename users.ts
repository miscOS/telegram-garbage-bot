import AppError from "./errors";

import fs from 'fs';
import path from 'path';

export class UserManager {

    constructor(
        private TZ: string = 'Europe/Berlin',
        private users: User[] = [],
        private userfile: string = path.join(__dirname, '..', 'data', 'garbage.users.json'),
    ) {
        this.load();
    }

    load() {
        try {
            const jsonContent = fs.readFileSync(this.userfile, 'utf-8');
            const jsonData = JSON.parse(jsonContent);

            this.users = jsonData.map( (userData: User) => {
                const user = new User(userData.id, userData.city, userData.street, userData.streetNumber, userData.location, userData.cronTime);
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
        public events: UserEvents = new UserEvents
    ) {}
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