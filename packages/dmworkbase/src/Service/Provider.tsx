import React, { HTMLProps,Component } from "react"

export interface IProviderListener {
    notifyListener():void;
    listen(f:(callback?:()=>void)=>void):void;
    clearListeners():void;
    didMount():void
    didUnMount():void
}

export class ProviderListener implements IProviderListener {
    callback?:(ck?:()=>void)=>void
    /**
     * Ad-hoc fan-out subscribers. The `callback` slot above is owned exclusively
     * by the Provider component (it overwrites whatever was there on mount), so
     * any view that lives outside the Provider's own subtree — e.g. children
     * pushed onto a RoutePage / WKViewQueue via `routeContext.push()` — cannot
     * use `listen()` to react to `notifyListener()`. Those views register here
     * via `addListener` and unregister on unmount.
     *
     * Why this exists (octo-web#95): `PersonaCreate` is a function component
     * pushed via `routeContext.push(<PersonaCreate vm={vm} />)`. WKViewQueue
     * captures that JSX in its own state, so the Provider's `setState({})` on
     * `notifyListener` does not bubble fresh props down to it; the bot list
     * stayed stuck on "暂无可关联的 Bot" forever even after `loadMyBots()`
     * resolved. Subscribing through `addListener` gives those rogue subtrees
     * a way to opt back into the VM update stream.
     */
    private listeners: Set<() => void> = new Set()

    notifyListener(stateCallback?:()=>void): void {
        if(this.callback) {
            this.callback(stateCallback)
        }
        if (this.listeners.size > 0) {
            // Snapshot first so a subscriber that synchronously unsubscribes
            // (e.g. unmounts during the callback) doesn't mutate the Set we
            // are iterating.
            for (const fn of Array.from(this.listeners)) {
                try {
                    fn()
                } catch (e) {
                    // A misbehaving subscriber must not break sibling subscribers
                    // or the legacy Provider callback path. Surface for debug.
                    // eslint-disable-next-line no-console
                    console.warn("[ProviderListener] subscriber threw", e)
                }
            }
        }
    }
    listen(f: (ck?:()=>void) => void): void {
       this.callback = f
    }

    /**
     * Subscribe to `notifyListener()` fan-out. Returns an unsubscribe handle
     * suitable for use as a `useEffect` cleanup. Safe to add the same `fn`
     * twice — Set semantics dedupe.
     */
    addListener(fn: () => void): () => void {
        this.listeners.add(fn)
        return () => {
            this.listeners.delete(fn)
        }
    }

    removeListener(fn: () => void): void {
        this.listeners.delete(fn)
    }

    didMount() {

    }

    clearListeners(): void {
        this.callback = undefined
        // Drop ad-hoc subscribers too: `clearListeners` is called from
        // `Provider.componentWillUnmount`, at which point the VM is on its way
        // out and any surviving subscriber is by definition stale.
        this.listeners.clear()
    }

    didUnMount(): void {

    }

}

export interface ProviderProps extends HTMLProps<any>{
    create: () => IProviderListener;
    render: (vm:any)=> React.ReactNode
}



export default class Provider extends Component<ProviderProps> {
    listener: IProviderListener
    constructor(props: ProviderProps) {
        super(props)
        this.state = {}
        this.listener = this.props.create()
      
       
    }
    componentDidMount() {
       
        this.listener.listen((callback)=>{
            this.setState({},()=>{
                if(callback) {
                    callback()
                }
            })
        })
        this.listener.didMount()
    }

    componentWillUnmount() {
        this.listener.clearListeners()
        this.listener.didUnMount()
    }
    render() {
        return <>
            {this.props.render(this.listener)}
        </>
    };

}

