import * as THREE from 'three'

/** Camera elevation (looking slightly down at the pet). */
const ELEVATION = THREE.MathUtils.degToRad(18)

/**
 * A small transparent canvas that follows the pet around the overlay. Rendering
 * only a pet-sized canvas (instead of a full-screen one) keeps GPU and
 * compositor work tiny.
 */
export class PetView {
  readonly canvas: HTMLCanvasElement
  readonly scene = new THREE.Scene()
  readonly camera: THREE.OrthographicCamera
  private renderer: THREE.WebGLRenderer
  private visible = true

  /** Canvas size in CSS px, and where the pet's feet sit inside it. */
  width = 0
  height = 0
  anchorX = 0
  anchorY = 0
  petSize = 0

  /**
   * @param petSize on-screen height of the pet in DIP
   * @param modelHeight height of the pet model in world units
   */
  constructor(
    container: HTMLElement,
    petSize: number,
    private modelHeight: number
  ) {
    this.canvas = document.createElement('canvas')
    container.appendChild(this.canvas)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power'
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000)
    const dist = 300
    this.camera.position.set(0, Math.sin(ELEVATION) * dist, Math.cos(ELEVATION) * dist)
    this.camera.lookAt(0, 0, 0)
    this.setPetSize(petSize)
  }

  setPetSize(size: number): void {
    this.petSize = size
    this.width = Math.round(size * 3.2)
    this.height = Math.round(size * 3)
    this.anchorX = Math.round(this.width / 2)
    this.anchorY = Math.round(this.height * 0.72)
    this.renderer.setSize(this.width, this.height, true)
    const ppu = size / this.modelHeight
    this.camera.left = -this.anchorX / ppu
    this.camera.right = (this.width - this.anchorX) / ppu
    this.camera.top = this.anchorY / ppu
    this.camera.bottom = -(this.height - this.anchorY) / ppu
    this.camera.updateProjectionMatrix()
  }

  /** Pixels per world unit at the current size. */
  get ppu(): number {
    return this.petSize / this.modelHeight
  }

  /** Position the canvas so the pet's feet land on (lx, ly) in overlay-local px. */
  place(lx: number, ly: number): void {
    const dpr = window.devicePixelRatio
    // Snap to device pixels so the pixel art stays crisp.
    const tx = Math.round((lx - this.anchorX) * dpr) / dpr
    const ty = Math.round((ly - this.anchorY) * dpr) / dpr
    this.canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return
    this.visible = v
    this.canvas.style.display = v ? 'block' : 'none'
  }

  render(): void {
    if (this.visible) this.renderer.render(this.scene, this.camera)
  }
}
