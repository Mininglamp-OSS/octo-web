import React, { HTMLProps,Component } from "react"

export interface IProviderListener {
    notifyListener():void;
    listen(f?:(callback?:()=>void)=>void):void;
    didMount():void
    didUnMount():void
}

export class ProviderListener implements IProviderListener {
    callback?:(ck?:()=>void)=>void
    notifyListener(stateCallback?:()=>void): void {
        if(this.callback) {
            this.callback(stateCallback)
        }
    }
    listen(f: (ck?:()=>void) => void): void {
       this.callback = f
    }

    didMount() {

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
        this.listener.listen(undefined)
        this.listener.didUnMount()
    }
    render() {
        return <>
            {this.props.render(this.listener)}
        </>
    };

}

