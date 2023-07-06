
export interface IModule {
    id(): string;
    init(): void;
}

export class ModuleManager {
    private constructor() {
    }
    public static shared = new ModuleManager()
    private moduleMap = new Map<string, IModule>();

    register(module: IModule) {
        this.moduleMap.set(module.id(), module);
        module.init();
    }
    get(id: string): IModule {

        return this.moduleMap.get(id)!;
    }
}


export class Endpoint {
    sid!: string
    category: string
    sort: number
    handler: (param: any) => any;

    constructor(sid: string, handler: (param: any) => any, { category = "", sort = 0 }: { category?: string, sort?: number }) {
        this.sid = sid
        this.handler = handler
        this.category = category
        this.sort = sort
    }
}

export class EndpointManager {
    private constructor() {
    }
    public static shared = new EndpointManager()
    private endpointIDMap = new Map<string, Endpoint>();
    private endpointCategoryMap = new Map<string, Array<Endpoint>>();

    register(endpoint: Endpoint) {
        this.endpointIDMap.set(endpoint.sid, endpoint)
        if (endpoint.category && endpoint.category !== "") {
            var endpoints = this.endpointCategoryMap.get(endpoint.category)
            if (endpoints && endpoints.length > 0) {
                endpoints = endpoints.filter((p) => p.sid !== endpoint.sid)
            } else {
                endpoints = []
            }
            endpoints.push(endpoint);
            this.endpointCategoryMap.set(endpoint.category, endpoints)
        }
    }
    get(sid: string): Endpoint | undefined {
        return this.endpointIDMap.get(sid);
    }
    getWithCategory(category: string): Endpoint[] | undefined {
        var endpoints = this.endpointCategoryMap.get(category);
        endpoints?.sort((a, b) => {
            return a.sort - b.sort;
        });
        return endpoints;
    }
    invoke(sid: string, param?: any) {
        var endpoint = EndpointManager.shared.get(sid);
        if (endpoint?.handler) {
            return endpoint?.handler!(param);
        }
    }
    invokes<T>(category: string, param?: any) {
        var endpoints = EndpointManager.shared.getWithCategory(category);
        var results = new Array<T>();
        if (endpoints && endpoints.length > 0) {
            for (const endpoint of endpoints) {
                var result = endpoint.handler!(param);
                if (result) {
                    results.push(result);
                }
            }
        }
        return results;
    }

    setMethod(sid: string, handler: (param: any) => any, config?: { category?: string, sort?: number }) {
        EndpointManager.shared.register(
            new Endpoint(sid, handler, { category: config?.category, sort: config?.sort || 0 }));
    }

    removeMethod(sid: string) {
        this.endpointIDMap.delete(sid)

       this.endpointCategoryMap.forEach((methods,key)=>{
            for (let index = 0; index < methods.length; index++) {
                const method = methods[index];
                if(method.sid === sid) {
                    methods.splice(index,1)
                }
                
            }
       })
    }
}