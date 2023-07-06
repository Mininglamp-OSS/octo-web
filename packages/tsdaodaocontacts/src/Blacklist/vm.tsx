import { ContactsChangeListener, WKApp, ProviderListener, UserRelation } from "@tsdaodao/base";


export default class BlacklistVM extends ProviderListener{
    contactsChangeListener!:ContactsChangeListener
    didMount(): void {

        this.contactsChangeListener = ()=>{
            this.notifyListener()
        }
        WKApp.dataSource.addContactsChangeListener(this.contactsChangeListener)
    }

    didUnMount(): void {
        WKApp.dataSource.removeContactsChangeListener(this.contactsChangeListener)
    }

    blacklist() {
      return  WKApp.dataSource.contactsList.filter((v)=>{
            return v.status === UserRelation.blacklist
        })
    }
}