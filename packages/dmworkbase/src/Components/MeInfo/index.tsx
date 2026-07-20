import { Toast } from "@douyinfe/semi-ui";
import { Check } from "lucide-react";
import React, { ChangeEvent, Component, ReactNode } from "react";
import RouteContext, { RouteContextConfig } from "../../Service/Context";
import Provider, { IProviderListener } from "../../Service/Provider";
import { I18nContext } from "../../i18n";
import { canvasToPngFile, isAvatarFileTooLarge, isGifImageFile } from "../avatarUpload";
import ExperimentalFeatures from "../ExperimentalFeatures";
import QRCodeMy from "../QRCodeMy";
import RoutePage from "../RoutePage";
import { WKAvatarEditor } from "../WKAvatarEditor";
import { WKAvatarUploadPreview } from "../WKAvatarUploadPreview";
import WKAvatar from "../WKAvatar";
import WKModal from "../WKModal";
import MeInfoPanel from "./MeInfoPanel";
import { MeInfoVM } from "./vm";
import "./index.css"

export interface MeInfoProps {
    onClose: () => void
}

interface MeInfoState {
    editingName: boolean
    nameDraft: string
    savingName: boolean
    savingSex: boolean
    showQrCode: boolean
    showSexSelect: boolean
    avatarCropFile: File | null
    avatarPreviewFile: File | null
    uploadingAvatar: boolean
}

export class MeInfo extends Component<MeInfoProps, MeInfoState> {
    static contextType = I18nContext
    declare context: React.ContextType<typeof I18nContext>

    private mounted = false
    private fileInput: HTMLInputElement | null = null
    private avatarEdit: WKAvatarEditor | null = null

    state: MeInfoState = {
        editingName: false,
        nameDraft: "",
        savingName: false,
        savingSex: false,
        showQrCode: false,
        showSexSelect: false,
        avatarCropFile: null,
        avatarPreviewFile: null,
        uploadingAvatar: false,
    }

    componentDidMount() {
        this.mounted = true
    }

    componentWillUnmount() {
        this.mounted = false
    }

    resetTransientState = () => {
        this.setState({
            editingName: false,
            nameDraft: "",
            savingName: false,
            savingSex: false,
            showQrCode: false,
            showSexSelect: false,
            avatarCropFile: null,
            avatarPreviewFile: null,
            uploadingAvatar: false,
        })
    }

    handleClose = () => {
        this.resetTransientState()
        this.props.onClose?.()
    }

    chooseAvatar = () => {
        this.fileInput?.click()
    }

    handleFileClick = (event: React.MouseEvent<HTMLInputElement>) => {
        event.currentTarget.value = ""
    }

    handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ""
        if (!file) return
        if (isAvatarFileTooLarge(file)) {
            Toast.error(this.context.t("base.channelAvatar.fileTooLarge"))
            return
        }
        if (isGifImageFile(file)) {
            this.setState({ avatarPreviewFile: file })
            return
        }
        this.setState({ avatarCropFile: file })
    }

    startEditName = (vm: MeInfoVM) => {
        this.setState({
            editingName: true,
            nameDraft: vm.name(),
        })
    }

    cancelEditName = () => {
        this.setState({
            editingName: false,
            nameDraft: "",
        })
    }

    saveName = async (vm: MeInfoVM) => {
        const { t } = this.context
        const requestedUid = vm.uid()
        const isCurrent = () => this.mounted && vm.uid() === requestedUid
        const nextName = this.state.nameDraft
        if (nextName.trim() === "") {
            Toast.error(t("base.me.nameRequired"))
            return
        }
        this.setState({ savingName: true })
        try {
            await vm.updateName(nextName)
            if (!isCurrent()) return
            this.setState({
                editingName: false,
                nameDraft: "",
            })
        } catch {
            // VM already surfaces the API error toast. Keep the editor open.
        } finally {
            if (isCurrent()) {
                this.setState({ savingName: false })
            }
        }
    }

    selectSex = async (vm: MeInfoVM, sex: number) => {
        if (this.state.savingSex) return
        const requestedUid = vm.uid()
        const isCurrent = () => this.mounted && vm.uid() === requestedUid
        if (sex === vm.sex()) {
            this.setState({ showSexSelect: false })
            return
        }
        this.setState({ savingSex: true })
        try {
            await vm.updateSex(sex)
            if (!isCurrent()) return
            this.setState({ showSexSelect: false })
        } catch {
            // VM already surfaces the API error toast. Keep the modal open.
        } finally {
            if (isCurrent()) {
                this.setState({ savingSex: false })
            }
        }
    }

    uploadAvatarFile = async (vm: MeInfoVM, file: File) => {
        const requestedUid = vm.uid()
        const isCurrent = () => this.mounted && vm.uid() === requestedUid
        this.setState({ uploadingAvatar: true })
        try {
            await vm.uploadAvatar(file, requestedUid)
            if (!isCurrent()) return false
            vm.markAvatarChanged(requestedUid)
            Toast.success(this.context.t("base.me.avatarUpdated"))
            return true
        } catch {
            if (isCurrent()) {
                Toast.error(this.context.t("base.channelAvatar.uploadFailedRetry"))
            }
            return false
        } finally {
            if (isCurrent()) {
                this.setState({ uploadingAvatar: false })
            }
        }
    }

    cancelAvatarCrop = () => {
        if (this.state.uploadingAvatar) return
        this.setState({ avatarCropFile: null })
    }

    cancelAvatarPreview = () => {
        if (this.state.uploadingAvatar) return
        this.setState({ avatarPreviewFile: null })
    }

    saveAvatarPreview = async (vm: MeInfoVM) => {
        const { avatarPreviewFile } = this.state
        if (!avatarPreviewFile) return
        const uploaded = await this.uploadAvatarFile(vm, avatarPreviewFile)
        if (uploaded) {
            this.setState({ avatarPreviewFile: null })
        }
    }

    saveAvatarCrop = async (vm: MeInfoVM) => {
        const canvas = this.avatarEdit?.getImageScaledToCanvas()
        if (!canvas) return
        let file: File
        try {
            file = await canvasToPngFile(canvas, "profilePicture.png")
        } catch {
            Toast.error(this.context.t("base.channelAvatar.imageProcessFailedRetry"))
            return
        }
        const uploaded = await this.uploadAvatarFile(vm, file)
        if (uploaded) {
            this.setState({ avatarCropFile: null })
        }
    }

    showExperimentalFeatures = (context: RouteContext<any>) => {
        const title = this.context.t("base.me.experimentalFeatures")
        context.push(
            <ExperimentalFeatures routeContext={context} />,
            new RouteContextConfig({ title }),
        )
    }

    renderPanel(vm: MeInfoVM, context: RouteContext<any>) {
        const { t } = this.context
        const {
            editingName,
            nameDraft,
            savingName,
            showQrCode,
            showSexSelect,
            avatarCropFile,
            avatarPreviewFile,
            uploadingAvatar,
        } = this.state
        const verified = vm.isRealnameVerified()
        const avatar = <WKAvatar channel={vm.currentUserChannel()} />
        const avatarMini = <WKAvatar channel={vm.currentUserChannel()} />
        const sexOptions = [
            { value: 0, label: t("base.common.notSet") },
            { value: 1, label: t("base.sexSelect.male") },
            { value: 2, label: t("base.sexSelect.female") },
        ]

        return <>
            <div className="wk-meinfo">
                <input
                    ref={(ref) => { this.fileInput = ref }}
                    className="wk-meinfo-file-input"
                    type="file"
                    accept="image/*"
                    multiple={false}
                    onClick={this.handleFileClick}
                    onChange={this.handleFileChange}
                />
                <MeInfoPanel
                    avatar={avatar}
                    avatarMini={avatarMini}
                    displayName={vm.selfDisplayName()}
                    isRealnameVerified={verified}
                    shortNo={vm.shortNo()}
                    profileTitle={t("base.me.profileSection")}
                    preferencesTitle={t("base.me.preferencesSection")}
                    securityTitle={t("base.me.accountSecurity")}
                    avatarLabel={t("base.me.avatar")}
                    nameLabel={t("base.me.name")}
                    shortNoLabel={t("base.me.shortNo", { values: { appName: vm.appName() } })}
                    qrcodeLabel={t("base.me.qrCode")}
                    genderLabel={t("base.me.gender")}
                    realnameLabel={t("base.me.realname.title")}
                    experimentalFeaturesLabel={t("base.me.experimentalFeatures")}
                    avatarActionLabel={t("base.me.changeAvatar")}
                    editNameLabel={t("base.me.editName")}
                    namePlaceholder={t("base.me.setName")}
                    notSetLabel={t("base.common.notSet")}
                    saveLabel={t("base.common.save")}
                    cancelLabel={t("base.common.cancel")}
                    nameValue={vm.name()}
                    nameDraft={nameDraft}
                    genderValue={vm.sexLabel()}
                    realnameValue={verified ? vm.formatVerifiedAtLabel() : t("base.me.realname.verifyNow")}
                    showExperimentalFeatures={vm.isLabModeEnabled()}
                    editingName={editingName}
                    savingName={savingName}
                    uploadingAvatar={uploadingAvatar}
                    onChooseAvatar={this.chooseAvatar}
                    onStartEditName={() => this.startEditName(vm)}
                    onNameDraftChange={(value) => this.setState({ nameDraft: value })}
                    onCancelName={this.cancelEditName}
                    onSaveName={() => this.saveName(vm)}
                    onShowQrCode={() => this.setState({ showQrCode: true })}
                    onShowGender={() => this.setState({ showSexSelect: true })}
                    onRealnameClick={() => vm.startRealnameVerify()}
                    onShowExperimentalFeatures={() => this.showExperimentalFeatures(context)}
                />
            </div>

            <WKModal
                title={t("base.me.qrCode")}
                visible={showQrCode}
                onCancel={() => this.setState({ showQrCode: false })}
                width={360}
                zIndex={1100}
                className="wk-meinfo-secondary-modal wk-meinfo-v2-modal wk-meinfo-qrcode-modal"
            >
                <div className="wk-meinfo-qrcode-content">
                    <QRCodeMy disableHeader={true} />
                </div>
            </WKModal>

            <WKModal
                title={t("base.me.selectGender")}
                visible={showSexSelect}
                onCancel={() => {
                    if (!this.state.savingSex) {
                        this.setState({ showSexSelect: false })
                    }
                }}
                width={320}
                zIndex={1100}
                className="wk-meinfo-secondary-modal wk-meinfo-v2-modal wk-meinfo-sex-select-modal"
                options={{
                    maskClosable: !this.state.savingSex,
                    closeOnEsc: !this.state.savingSex,
                }}
            >
                <div className="wk-meinfo-sex-modal">
                    <div className="wk-meinfo-section-rows wk-meinfo-sex-list">
                        {sexOptions.map((option) => {
                            const selected = option.value === vm.sex()
                            return <button
                                key={option.value}
                                type="button"
                                className="wk-meinfo-row wk-meinfo-row--button wk-meinfo-sex-row"
                                disabled={this.state.savingSex}
                                onClick={() => this.selectSex(vm, option.value)}
                            >
                                <span className="wk-meinfo-row-main">
                                    <span className="wk-meinfo-row-label">{option.label}</span>
                                </span>
                                <span className="wk-meinfo-row-side wk-meinfo-sex-row-check">
                                    {selected && <Check size={16} aria-hidden="true" />}
                                </span>
                            </button>
                        })}
                    </div>
                </div>
            </WKModal>

            <WKModal
                title={t("base.channelAvatar.previewAvatar")}
                visible={!!avatarPreviewFile}
                onCancel={this.cancelAvatarPreview}
                width={460}
                zIndex={1100}
                className="wk-meinfo-secondary-modal wk-meinfo-avatar-preview-modal"
                footerConfig={{
                    okText: t("base.common.save"),
                    cancelText: t("base.common.cancel"),
                    isOkLoading: uploadingAvatar,
                    onOk: () => this.saveAvatarPreview(vm),
                }}
                options={{
                    maskClosable: !uploadingAvatar,
                    closeOnEsc: !uploadingAvatar,
                }}
            >
                {avatarPreviewFile && <WKAvatarUploadPreview file={avatarPreviewFile} />}
            </WKModal>

            <WKModal
                title={t("base.channelAvatar.cropAvatar")}
                visible={!!avatarCropFile}
                onCancel={this.cancelAvatarCrop}
                width={460}
                zIndex={1100}
                className="wk-meinfo-secondary-modal wk-meinfo-avatar-crop-modal"
                footerConfig={{
                    okText: t("base.common.save"),
                    cancelText: t("base.common.cancel"),
                    isOkLoading: uploadingAvatar,
                    onOk: () => this.saveAvatarCrop(vm),
                }}
                options={{
                    maskClosable: !uploadingAvatar,
                    closeOnEsc: !uploadingAvatar,
                }}
            >
                {avatarCropFile && <div className="wk-meinfo-avatar-crop-editor">
                    <WKAvatarEditor
                        ref={(ref) => { this.avatarEdit = ref }}
                        file={avatarCropFile}
                    />
                </div>}
            </WKModal>
        </>
    }

    render() {
        const title = this.context.t("base.meInfo.title")
        return <Provider create={function (): IProviderListener {
            return new MeInfoVM()
        }} render={(vm: MeInfoVM): ReactNode => {
            return <RoutePage title={title} onClose={this.handleClose} className="wk-meinfo-route" render={(context: RouteContext<any>): ReactNode => {
                return this.renderPanel(vm, context)
            }}></RoutePage>
        }}></Provider>
    }
}
