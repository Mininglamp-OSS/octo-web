import { Table } from "@douyinfe/semi-ui"
import { TableProps } from "@douyinfe/semi-ui/lib/es/table"
import React,{ Component } from "react"

export interface WKTableProps extends TableProps {
    
}

export default class WKTable<T> extends Component<WKTableProps> {

    render() {
        const {columns,dataSource}  = this.props
        return <Table<T> columns={columns} dataSource={dataSource}>

        </Table>
    }
}