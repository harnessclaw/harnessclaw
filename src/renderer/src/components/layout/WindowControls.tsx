import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/**
 * 自定义窗口控制按钮(最小化 / 最大化-还原 / 关闭)。
 *
 * 主进程两个平台都用无边框标题栏(`titleBarStyle: 'hidden'`,macOS 另外
 * 隐藏原生交通灯),因此这三个按钮由渲染层绘制,通过 `window.windowControls`
 * 暴露的 IPC 控制窗口。组件挂在 <AppLayout> 顶部右侧,所有页面共用。
 *
 * 图标取自设计稿(`前端设计图/首页/{最小化,放大,关闭}.svg`,14×14),
 * fill/stroke 改为 currentColor 以支持 hover 变色与深色模式自适应。中间按钮:
 * 窗口态显示「最大化」图标(`前端设计图/UI走查/最大化框.svg`,单窗口框),
 * 最大化/全屏态切换为「还原」图标(两个叠放窗口框)。
 */
export function WindowControls() {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const controls = window.windowControls
    if (!controls) return
    void controls.isMaximized().then(setMaximized)
    const unsubscribe = controls.onMaximizedChanged(setMaximized)
    return unsubscribe
  }, [])

  const controls = typeof window !== 'undefined' ? window.windowControls : undefined
  if (!controls) return null

  if (IS_MAC) {
    return (
      <div className="titlebar-no-drag fixed left-4 top-4 z-50 flex items-center gap-2">
        <MacTrafficButton
          label={t('window.close')}
          title={t('window.close')}
          className="border-[#e2463f] bg-[#ff5f57]"
          onClick={() => void controls.close()}
        >
          <MacCloseGlyph />
        </MacTrafficButton>

        <MacTrafficButton
          label={t('window.minimize')}
          title={t('window.minimize')}
          className="border-[#dea123] bg-[#ffbd2e]"
          onClick={() => void controls.minimize()}
        >
          <MacMinimizeGlyph />
        </MacTrafficButton>

        <MacTrafficButton
          label={maximized ? t('window.restore') : t('window.maximize')}
          title={maximized ? t('window.restore') : t('window.maximize')}
          className="border-[#1ead35] bg-[#28c840]"
          onClick={() => void controls.toggleMaximize()}
        >
          {maximized ? <MacRestoreGlyph /> : <MacZoomGlyph />}
        </MacTrafficButton>
      </div>
    )
  }

  return (
    <div
      className={`titlebar-no-drag fixed z-50 flex items-center gap-3 ${
        maximized ? 'right-4 top-4' : 'right-7 top-7'
      }`}
    >
      <button
        type="button"
        onClick={() => void controls.minimize()}
        aria-label={t('window.minimize')}
        title={t('window.minimize')}
        className="titlebar-no-drag flex h-[14px] w-[14px] items-center justify-center text-foreground/70 transition-colors hover:text-foreground"
      >
        <MinimizeIcon />
      </button>

      <button
        type="button"
        onClick={() => void controls.toggleMaximize()}
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        title={maximized ? t('window.restore') : t('window.maximize')}
        className="titlebar-no-drag flex h-[14px] w-[14px] items-center justify-center text-foreground/70 transition-colors hover:text-foreground"
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>

      <button
        type="button"
        onClick={() => void controls.close()}
        aria-label={t('window.close')}
        title={t('window.close')}
        className="titlebar-no-drag flex h-[14px] w-[14px] items-center justify-center text-foreground/70 transition-colors hover:text-red-500"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

function MacTrafficButton({
  label,
  title,
  className,
  onClick,
  children,
}: {
  label: string
  title: string
  className: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className={`titlebar-no-drag group/window-button flex h-3 w-3 items-center justify-center rounded-full border text-black/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition brightness-100 hover:brightness-95 ${className}`}
    >
      <span className="opacity-0 transition-opacity group-hover/window-button:opacity-100">
        {children}
      </span>
    </button>
  )
}

function MacCloseGlyph() {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
      <path d="M1 1L5 5M5 1L1 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function MacMinimizeGlyph() {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
      <path d="M1 3H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function MacZoomGlyph() {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
      <path d="M1.5 1H5V4.5M5 1L1 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MacRestoreGlyph() {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
      <path d="M1 5V1.5M1 5H4.5M1 5L5 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MinimizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1.75,6.9999592865625C1.75,6.6777930565625,2.01116708,6.4166259765625,2.33333331,6.4166259765625C2.33333331,6.4166259765625,11.666666,6.4166259765625,11.666666,6.4166259765625C11.988841,6.4166259765625,12.25,6.6777930565625,12.25,6.9999592865625C12.25,7.3221225765625,11.988841,7.5832925765625,11.666666,7.5832925765625C11.666666,7.5832925765625,2.33333331,7.5832925765625,2.33333331,7.5832925765625C2.01116708,7.5832925765625,1.75,7.3221225765625,1.75,6.9999592865625C1.75,6.9999592865625,1.75,6.9999592865625,1.75,6.9999592865625Z"
        fillRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}

// 最大化/全屏态的「还原」图标:两个叠放的窗口方框。
function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.25,1.75C4.6056674,1.75,4.0833333,2.2723341599999998,4.0833333,2.9166666C4.0833333,2.9166666,4.0833333,4.0833333,4.0833333,4.0833333C4.0833333,4.0833333,2.9166666,4.0833333,2.9166666,4.0833333C2.27233469,4.0833333,1.75,4.6056674,1.75,5.25C1.75,5.25,1.75,11.083333,1.75,11.083333C1.75,11.7276831,2.2723341599999998,12.25,2.9166666,12.25C2.9166666,12.25,8.75,12.25,8.75,12.25C9.3943496,12.25,9.916666,11.7276831,9.916666,11.083333C9.916666,11.083333,9.916666,9.916666,9.916666,9.916666C9.916666,9.916666,11.083333,9.916666,11.083333,9.916666C11.7276831,9.916666,12.25,9.3943496,12.25,8.75C12.25,8.75,12.25,2.9166666,12.25,2.9166666C12.25,2.27233469,11.7276831,1.75,11.083333,1.75C11.083333,1.75,5.25,1.75,5.25,1.75C5.25,1.75,5.25,1.75,5.25,1.75ZM9.916666,8.75C9.916666,8.75,11.083333,8.75,11.083333,8.75C11.083333,8.75,11.083333,2.9166666,11.083333,2.9166666C11.083333,2.9166666,5.25,2.9166666,5.25,2.9166666C5.25,2.9166666,5.25,4.0833333,5.25,4.0833333C5.25,4.0833333,8.75,4.0833333,8.75,4.0833333C9.3943496,4.0833333,9.916666,4.6056674,9.916666,5.25C9.916666,5.25,9.916666,8.75,9.916666,8.75C9.916666,8.75,9.916666,8.75,9.916666,8.75ZM2.9166666,5.25C2.9166666,5.25,8.75,5.25,8.75,5.25C8.75,5.25,8.75,11.083333,8.75,11.083333C8.75,11.083333,2.9166666,11.083333,2.9166666,11.083333C2.9166666,11.083333,2.9166666,5.25,2.9166666,5.25C2.9166666,5.25,2.9166666,5.25,2.9166666,5.25Z"
        fillRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}

// 非最大化(窗口)态的「最大化」图标(设计稿 前端设计图/UI走查/最大化框.svg)。
// 圆角窗口框 + 填充顶栏;stroke/fill 均用 currentColor,随按钮颜色/hover 变化。
function MaximizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect
        x="1.766992211341858"
        y="1.766503930091858"
        width="10.466665983200073"
        height="10.466665983200073"
        rx="1.399999976158142"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2000000476837158"
      />
      <path
        d="M12.8336581875,4.16650390625L12.8336581875,3.16650390625Q12.8336581875,3.06825030625,12.8240281875,2.9704697062500003Q12.8143981875,2.87268900625,12.7952291875,2.77632320625Q12.7760611875,2.67995740625,12.7475391875,2.58593450625Q12.7190171875,2.49191150625,12.6814161875,2.40113690625Q12.6438171875,2.31036230625,12.5975011875,2.22371030625Q12.5511841875,2.1370583762499997,12.4965961875,2.05536335625Q12.4420111875,1.97366845625,12.3796791875,1.89771735625Q12.3173481875,1.82176625625,12.2478711875,1.75229030625Q12.1783961875,1.68281447625,12.1024441875,1.62048300625Q12.0264931875,1.55815151625,11.9447971875,1.50356465625Q11.8631031875,1.44897782625,11.7764511875,1.40266136625Q11.6897981875,1.35634487625,11.5990241875,1.3187448262500001Q11.5082501875,1.28114476625,11.4142261875,1.25262323025Q11.3202041875,1.22410168825,11.2238381875,1.20493334125Q11.1274728875,1.18576499825,11.0296926875,1.17613445225Q10.9319123875,1.16650390625,10.8336581875,1.16650390625L3.1669921875,1.16650390625Q3.0687385875,1.16650390625,2.9709579875000003,1.17613445225Q2.8731772875,1.18576499825,2.7768114875,1.20493334125Q2.6804456875,1.22410168825,2.5864227875,1.25262323025Q2.4923997875,1.28114476625,2.4016251875,1.3187448262500001Q2.3108505875,1.35634487625,2.2241985875,1.4026613562499999Q2.1375466574999997,1.44897782625,2.0558516375,1.50356465625Q1.9741567375,1.55815151625,1.8982056375,1.62048297625Q1.8222545375,1.68281447625,1.7527785875,1.75229030625Q1.6833027575,1.82176625625,1.6209712875,1.89771735625Q1.5586397975,1.97366851625,1.5040529375,2.05536341625Q1.4494661075,2.1370583762499997,1.4031496475,2.22371030625Q1.3568331575,2.31036230625,1.3192331075000001,2.40113690625Q1.2816330475,2.49191150625,1.2531115115,2.58593450625Q1.2245899695,2.67995740625,1.2054216225,2.77632320625Q1.1862532795,2.87268900625,1.1766227335,2.9704697062500003Q1.1669921875,3.06825030625,1.1669921875,3.16650390625L1.1669921875,4.16650390625L12.8336581875,4.16650390625Z"
        fillRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M6.9997506625,7.8250727734375C6.9997506625,7.8250727734375,10.2995676625,11.1248845734375,10.2995676625,11.1248845734375C10.5273594625,11.3527335734375,10.8967265625,11.3527335734375,11.1245183625,11.1248845734375C11.3523673625,10.8970927734375,11.3523673625,10.5277256734375,11.1245183625,10.2999338734375C11.1245183625,10.2999338734375,7.8247065625,7.0001168734375,7.8247065625,7.0001168734375C7.8247065625,7.0001168734375,11.1245183625,3.7002877634375,11.1245183625,3.7002877634375C11.3523673625,3.4724786234375,11.3523673625,3.1031352534375,11.1245183625,2.8753290334375C10.8967265625,2.6475233804375,10.5273594625,2.6475236114375,10.2995676625,2.8753290334375C10.2995676625,2.8753290334375,6.9997506625,6.1751551734375,6.9997506625,6.1751551734375C6.9997506625,6.1751551734375,3.6999157025000002,2.8753220434375,3.6999157025000002,2.8753220434375C3.4721065725,2.6475163254375,3.1027615025,2.6475163814375,2.8749558525,2.8753220434375C2.6471501365,3.1031282834375,2.6471501365,3.4724727834375,2.8749558525,3.7002819134375002C2.8749558525,3.7002819134375002,6.1747889625,7.0001168734375,6.1747889625,7.0001168734375C6.1747889625,7.0001168734375,2.8749558525,10.2999338734375,2.8749558525,10.2999338734375C2.6471503075,10.5277838734375,2.6471503075,10.8970927734375,2.8749558525,11.1248845734375C3.1027621025,11.3527335734375,3.4721065725,11.3527335734375,3.6999157025000002,11.1248845734375C3.6999157025000002,11.1248845734375,6.9997506625,7.8250727734375,6.9997506625,7.8250727734375C6.9997506625,7.8250727734375,6.9997506625,7.8250727734375,6.9997506625,7.8250727734375Z"
        fillRule="evenodd"
        fill="currentColor"
      />
    </svg>
  )
}
