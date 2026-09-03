/**
 * Bảng màu của "Phiên toà sống".
 *
 * MODULE RIÊNG, cùng lý do mà `village-memory-palette` tồn tại: lớp React cần
 * vài sắc này cho viền thẻ và cho bản dự phòng 2D, mà một `import` tĩnh vào file
 * dựng cảnh là một cạnh trong đồ thị module - bundler không cắt file làm đôi,
 * nên cả phần Three.js sẽ đi thẳng vào chunk của component, kể cả với người
 * không bao giờ bật tính năng này.
 *
 * Vì vậy file này KHÔNG biết Three.js tồn tại và không `import` gì cả. Nó cũng
 * là thứ giữ cho bản 2D và bản 3D dùng chung MỘT bảng màu thay vì hai bảng phải
 * canh cho khớp nhau.
 */

/**
 * Hai nguồn sáng, hai ý nghĩa - và cả cảnh chỉ có đúng hai.
 *
 * Trăng lạnh là ngôi làng đang nhìn; đèn ấm là chỗ bị cáo đang đứng. Mọi thứ
 * khác đều là một sắc trong dải xanh đêm hẹp, nên hai điểm ấm/lạnh này đủ để
 * mắt tách được ba lớp (bục, người, đám đông) mà không cần kéo cả cảnh sáng lên.
 */
export const TRIAL_HEX = {
  /** Nền trời, và cũng là màu sương xa: hai thứ bằng nhau thì rìa cảnh mới tan. */
  sky: 0x070c18,
  groundOuter: 0x0b1424,
  /** Quảng trường lát đá quanh bục. */
  plaza: 0x172640,
  plazaGlow: 0x2b4a7d,

  /** Bục xét xử: khối sáng nhất của nền, để bóng người tách hẳn ra khỏi nó. */
  dais: 0x46557a,
  daisShade: 0x232f4b,

  /** Bị cáo. Cố ý TRUNG TÍNH: không sắc vai, không sắc phe. */
  accused: 0xb9c6e0,
  accusedShade: 0x6d7b98,

  /**
   * Khán giả - bối cảnh, và chỉ là bối cảnh. Không ai trong đám này sáng lên.
   *
   * Sáng hơn nền một nấc vừa đủ để ra một VÒNG người đứng quanh quảng trường:
   * ở sắc tối hơn, cả vòng chìm hẳn vào đất và cảnh đọc ra như một cái bục
   * trống giữa hư không. Vẫn tối hơn hẳn bục và bị cáo, nên mắt không bao giờ
   * đi tìm thông tin ở đó.
   */
  crowd: 0x1c2a44,

  /** Cán cân. Đồng cũ, đủ ấm để đọc được trên nền lạnh. */
  scaleFrame: 0x8a7448,
  scalePan: 0xa88c52,

  /** Bên Treo và bên Tha. Màu là lớp THỨ HAI - chữ và ký hiệu mới là lớp đầu. */
  guilty: 0xdc2640,
  innocent: 0x2f9e6a,

  moon: 0xe6ecff,
  moonHalo: 0x91a9e2,
  moonLight: 0xa9c0f2,
  rimLight: 0x6b93cf,
  fillSky: 0x2e4a76,
  fillGround: 0x0d1422,

  /** Đèn ấm rọi bị cáo. Điểm ấm DUY NHẤT của cảnh. */
  lamp: 0xffc46b,
  lampWarm: 0xff9d3d,
} as const;

export const hexToCss = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;
