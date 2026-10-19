// Ported from the standard UI materials' D3D11 bytecode. See ghost-reference.json.
export const ghostMistVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize, uOutputFrame, uOutputTexture;
void main() {
    vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    gl_Position = vec4(p.x * 2.0 / uOutputTexture.x - 1.0,
        p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0.0, 1.0);
    vTextureCoord = aPosition * uOutputFrame.zw * uInputSize.zw;
}`

export const ghostMistFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uOpacity;
void main() { finalColor = texture(uTexture, vTextureCoord) * uOpacity; }
`

export const ghostMeshVertex = `
in vec2 aPosition, aUV;
in vec4 aParticleColor;
out vec2 vUV;
out vec4 vColor;
uniform mat3 uProjectionMatrix, uWorldTransformMatrix, uTransformMatrix;
void main() {
    vUV = aUV; vColor = aParticleColor;
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}`

export const ghostMeshFragment = `
in vec2 vUV;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uArtwork, uClouds;
uniform vec4 uTint;
uniform vec2 uScroll;
uniform float uKind, uIntensity, uTextureScale, uSoftness, uOpacity;
void main() {
    vec4 tex = texture(uArtwork, vUV);
    if (uKind < 0.5) {
        // AddMultiplyFXScrolling uses Unity _Time.x (seconds / 20).
        // PNG rows are flipped relative to Unity UVs; scrolling must flip too.
        vec2 unityUV = vec2(vUV.x, 1.0-vUV.y) * uTextureScale + uScroll;
        vec4 cloud = texture(uClouds, vec2(unityUV.x, 1.0-unityUV.y));
        vec4 mask = vec4(tex.rgb * uTint.rgb, tex.a * (uTint.a-tex.a));
        finalColor = clamp(mask * cloud * vColor * (2.0*uIntensity*uTint.a), 0.0, 1.0) * uOpacity;
    } else {
        // Additive and Particles_Transparent multiply vertex color by 2*Tint.
        // LightMotes uses _ColorMul=2 and the white _Color material.
        vec4 color = tex * vColor * (2.0*uTint);
        color.a = pow(max(color.a, 0.0), uSoftness);
        // Bake SrcAlpha for Pixi's premultiplied blends. Transparent smoke uses
        // conventional alpha coverage so nested Pixi compositing stays valid.
        finalColor = vec4(color.rgb * color.a * uIntensity,
            uKind > 2.5 ? color.a : color.a * color.a) * uOpacity;
    }
}`
