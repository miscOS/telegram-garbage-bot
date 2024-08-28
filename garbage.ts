import { CronJob } from "cron";
import { DateTime } from "luxon";
import { Context, Telegraf } from "telegraf";
import { message } from 'telegraf/filters';
import { UserManager, User } from "./users";
import { RegioITApi, Event } from "./api";
import AppError from "./errors";

export default class GarbageBot {

    private cronJob: CronJob;
    private cronStep: number;

    constructor(
        private chat: Telegraf,
        private users: UserManager = new UserManager,
        private api: RegioITApi = new RegioITApi(),
    ) { }

    private addComands() {
        // Register
        this.chat.command('register', async (ctx) => {
            try {
                this.users.addUser(ctx.message.chat.id);
                ctx.reply('Ich habe einen Account für dich angelegt. Ich benötige noch deinen Wohnort.\n\nIn welcher Stadt wohnst du?');
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        })
        // Remove
        this.chat.command('remove', async (ctx) => {
            try {
                this.users.deleteUser(ctx.message.chat.id);
                ctx.reply('Ich habe deine vorhanden Daten gelöscht. Mit /register kannst du dich neu anmelden.');
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Reminder
        this.chat.command('reminder', async (ctx) => {
            try {
                const user = this.users.getUser(ctx.message.chat.id);

                if (!this.cronJob) {
                    ctx.reply('Mein automatischer Reminder ist nicht aktiv.');
                } else {
                    if (ctx.payload) {
                        let [hour, minute] = this.parseCronTime(ctx.payload);
                        user.cronTime = DateTime.utc().setZone(user.timezone).set({ hour, minute, second: 0, millisecond: 0 });
                        user.events.changed();
                        ctx.reply(`Es wird nun jeden Tag um ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} Uhr geprüft, ob am nächsten Tag eine Abholung stattfindet.`);
                    } else {
                        user.cronTime = undefined;
                        user.events.changed();
                        ctx.reply(`Die automatische Erinnerung wurde gelöscht.`);
                    }
                }
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Next
        this.chat.command('next', async (ctx) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [1, 4, 7] });
                ctx.reply(`Bei der Abholung am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} wird folgendes mitgenommen:\n \u22C5 ${events.garbage.join('\n \u22C5 ')}`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Paper
        this.chat.command('paper', async (ctx) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [4] });
                ctx.reply(`${events.garbage[0]} wird am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} abgeholt.`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
        // Plastic
        this.chat.command('plastic', async (ctx) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);
                const events = await this.getEvents(user, { wasteTypes: [1] });
                ctx.reply(`${events.garbage[0]} wird am ${events.date.toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} abgeholt.`);
            } catch (error) {
                this.errorResponse(ctx, error);
            }
        });
    }

    private async addConfigurationDialog() {
        this.chat.on(message('text'), async (ctx, next) => {
            try {
                let user = this.users.getUser(ctx.message.chat.id);

                if (!user.city || !user.street || !user.streetNumber || !user.location) {
                    await this.setLocation(user, ctx.message.text);

                    if (!user.street) {
                        ctx.reply(`In welcher Straße wohnst du?`);
                    } else if (!user.streetNumber) {
                        ctx.reply(`Wie lautet deine Hausnummer?`);
                    } else {
                        ctx.reply(`Einrichtung abgeschlossen. Mit /reminder hh:mm kannst du die automatische Erinnerung einstellen.`);
                    }
                }
            } catch (error) {
                if (!(error instanceof AppError && error.code === 'UserDoesNotExistsExcpetion')) {
                    this.errorResponse(ctx, error);
                }
            }
            next();
        });
    }

    private async getEvents(user: User, filter: { wasteTypes: number[], date?: Date }, retry: boolean = true): Promise<{ date: Date, garbage: string[] }> {
        try {
            return this.api.getEvents(user.location, filter.wasteTypes).then((events: Event[]) => {

                const today: Date = new Date();
                let nextEvent: Date = new Date();

                if (filter.date) {
                    nextEvent = filter.date;
                } else {
                    events = events.filter(event => new Date(event.datum) >= today);
                    nextEvent = new Date(events[0].datum);
                    events.forEach(event => {
                        const eventDate: Date = new Date(event.datum);
                        if (eventDate < nextEvent) {
                            nextEvent = eventDate;
                        }
                    })
                }

                const garbageEvents: string[] = events
                    .filter(event => event.datum === nextEvent.toISOString().split('T')[0])
                    .map(event => this.api.getGarbageType(event.bezirk.fraktionId));


                return {
                    date: nextEvent,
                    garbage: garbageEvents
                }
            });
        } catch (error) {
            // Rerun the function after retrieving new location id (in case the locationid is no longer valid)
            if (error instanceof AppError && error.code === 'InvalidResponseExcpetion' && retry) {
                return this.setLocation(user).then(() => this.getEvents(user, filter, false));
            } else {
                throw error;
            }
        }
    }

    private async setLocation(user: User, location?: string) {
        if (!user.city) {
            await this.api.getCity(location).then(city => {
                user.city = city.name.toLowerCase();
                user.events.changed();
            });
        } else if (!user.street) {
            const city = await this.api.getCity(user.city);
            await this.api.getStreet(city, location).then(street => {
                user.street = street.name.toLowerCase();
                user.events.changed();
            });
        } else if (!user.streetNumber) {
            const city = await this.api.getCity(user.city);
            const street = await this.api.getStreet(city, user.street);
            await this.api.getStreetNumber(street, location).then(streetNumber => {
                user.streetNumber = streetNumber.nr.toLowerCase();
                user.location = streetNumber.id;
                user.events.changed();
            });
        } else if (!location) {
            const city = await this.api.getCity(user.city);
            const street = await this.api.getStreet(city, user.street);
            await this.api.getStreetNumber(street, user.streetNumber).then(streetNumber => {
                user.location = streetNumber.id;
                user.events.changed();
            });
        }
    }

    private parseCronTime(payload: string): [number, number] {
        let [hour, minute] = payload.split(':').map(Number);

        if (hour < 0 || hour > 24 || minute < 0 || minute > 59) {
            throw new AppError('InvalidChronArgumentExcpetion', 'hour needs to be an integer between 0 and 24, minute needs to be an integer between 0 and 59.');
        }

        // Limit CronTime to CronSteps
        if (minute % this.cronStep > Math.floor(this.cronStep / 2)) {
            minute += this.cronStep - minute % this.cronStep;
        } else {
            minute -= minute % this.cronStep;
        }

        // Respect Minute Limit
        if (minute >= 60) {
            minute -= 60;
            hour += 1;
        }

        return [hour, minute];
    }

    private runCron() {
        this.users.getAllUsers().forEach(async user => {
            if(!user.cronTime) return;

            const utcDateTime = DateTime.utc();
            const cronDateTime = user.cronTime.toUTC();

            const utcMinutes = utcDateTime.hour * 60 + utcDateTime.minute;
            const cronMinutes = cronDateTime.hour *60 + cronDateTime.minute;

            if(Math.abs(utcMinutes - cronMinutes) < this.cronStep) {
                const date = new Date();
                date.setDate(date.getDate() + 1);

                const events = await this.getEvents(user, { wasteTypes: [1, 4, 7], date })
                if( events.garbage.length > 0)
                    this.chat.telegram.sendMessage(user.id, `Morgen wird folgendes mitgenommen:\n \u22C5 ${events.garbage.join('\n \u22C5 ')}`);
            }
        })
    }

    public setCronJob(minuteStep: number) {
        if (this.cronJob) this.cronJob.stop();
        // Limit Cronstep between 1 and 30 minutes
        this.cronStep = Math.max(1, Math.min(30, minuteStep));
        this.cronJob = new CronJob(`*/${this.cronStep} * * * *`, this.runCron.bind(this));
        this.cronJob.start();
    }

    private errorResponse(ctx: Context, error: AppError) {
        if (error instanceof AppError) {
            switch (error.code) {
                case 'UserAlreadyExistsExcpetion':
                    ctx.reply(`Du bist bereits registriert. Mit /remove kannst du deinen Account löschen.`);
                    break;
                case 'CityNotFoundExcpetion':
                    ctx.reply(`Die Stadt "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Stadt in der du wohnst.`);
                    break;
                case 'StreetNotFoundExcpetion':
                    ctx.reply(`Die Stadt "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Stadt in der du wohnst.`);
                    break;
                case 'StreetNumberNotFoundExcpetion':
                    ctx.reply(`Die Hausnummer "${ctx.text}" konnte ich nicht finden. Bitte nenne mir erneut die Hausnummer in der du wohnst.`);
                    break;
                case 'InvalidChronArgumentExcpetion':
                    ctx.reply(`Ich konnte den Chronjob nicht erstellen. Bitte nutze das korrekte Format.\nBeispiel: "/reminder 20:15" für eine Erinnerung am Vortag um 20:15 Uhr.`);
                    break;
                default:
                    ctx.reply(`Unbekannter API Fehler.`);
            }
        }
    }

    run() {
        this.addComands();
        this.addConfigurationDialog();
    }
}