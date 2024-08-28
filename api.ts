import AppError from "./errors";

export class RegioITApi {

    constructor(
        private baseUrl: URL = new URL('abfall-app-aachen/rest/', 'https://aachen-abfallapp.regioit.de'),
        private garbageTypes: Object = {
            0: 'Biomüll',
            1: 'Gelber Sack',
            4: 'Papiermüll',
            7: 'Restmüll'
        }
    ) { }

    getGarbageType(id: number): string{
        return this.garbageTypes[id];
    }

    async getEvents(locationId: number, filter?: {wasteTypes: number[], date?: string}): Promise<Event[]> {

        const filterString: string = (filter) ? filter.wasteTypes.map(nr => `fraktion=${nr}`).join('&') : '';

        return fetch(new URL(`hausnummern/${locationId}/termine?${filterString}`, this.baseUrl))
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                throw new AppError('InvalidResponseExcpetion', 'fetch could not retrieve a valid response');
            })
    }

    async getCity(location: string): Promise<City> {

        return await fetch(new URL('orte/', this.baseUrl))
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                throw new AppError('InvalidResponseExcpetion', 'fetch could not retrieve a valid response');
            })
            .then((responseJson: City[]) => {
                const result: City = responseJson.find((data: City) => data.name.toLowerCase() === location.toLowerCase());
                if (!result) throw new AppError('CityNotFoundExcpetion', 'the city is not in the databse');
                return result;
            });
    }

    async getStreet(city: City, location: string): Promise<Street> {

        return await fetch(new URL(`orte/${city.id}/strassen/`, this.baseUrl))
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                throw new AppError('InvalidResponseExcpetion', 'fetch could not retrieve a valid response');
            })
            .then((responseJson: Street[]) => {
                const result: Street = responseJson.find((data: Street) => data.name.toLowerCase() === location.toLowerCase());
                if (!result) throw new AppError('StreetNotFoundExcpetion', 'the street is not in the databse');
                return result;
            });
    }

    async getStreetNumber(street: Street, location: string): Promise<StreetNumber> {

        return await fetch(new URL(`strassen/${street.id}/`, this.baseUrl))
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                throw new AppError('InvalidResponseExcpetion', 'fetch could not retrieve a valid response');
            })
            .then((responseJson: Street) => {
                const result: StreetNumber = responseJson.hausNrList.find((data: StreetNumber) => data.nr.toLowerCase() === location.toLowerCase());
                if (!result) throw new AppError('StreetNumberNotFoundExcpetion', 'the street number is not in the databse');
                return result;
            });
    }
}

export class City {
    id: number;
    name: string;
}

export class Street {
    id: number;
    name: string;
    staticId: string;
    hausNrList: StreetNumber[];
    plz: number;
    gueltigBis: string;
    ortsteilName: string;
    ort: City;
}

export class StreetNumber {
    id: number;
    nr: string;
    plz: string;
    staticID: string;
    gueltigBis: string;
}

export class Bezirk {
    id: number;
    name: string;
    gueltigAb: string;
    fraktionId: number;
}

export class Event {
    id: number;
    bezirk: Bezirk;
    datum: string;
    jahr: string;
    info: string;
}