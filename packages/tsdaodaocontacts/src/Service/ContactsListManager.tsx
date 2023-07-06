
export class ContactsListManager {

    private constructor() {
    }
    public static shared = new ContactsListManager()

    setRefreshList!:()=>void
    refreshList() {
        this.setRefreshList()
    }
}