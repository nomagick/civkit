export function parseDockerImageName(text: string) {
    const vec = text.split('/').filter(Boolean);

    let registry = '';
    if (vec.length >= 2) {
        const potentialRegistry = vec[0];
        if (potentialRegistry.includes('.')) {
            registry = potentialRegistry;
            vec.shift();
        }
    }

    const image = vec.join('/');

    const tagVec = image.split(':').filter(Boolean);

    let tag = 'latest';
    let repo = image;
    if (tagVec.length >= 2) {
        tag = tagVec.pop()!;
        repo = tagVec.join(':');
    }

    if (!repo) {
        return undefined;
    }

    return {
        registry,
        repo,
        tag,
        name: `${repo}:${tag}`,
        image: `${registry}/${repo}:${tag}`,
    };
}

export enum DOCKER_SUPPORTED_PLATFORMS {
    LINUX_I386 = 'linux/386',
    LINUX_X86_64 = 'linux/amd64',
    LINUX_X86_64_V2 = 'linux/amd64/v2',
    LINUX_RISCV_64 = 'linux/riscv64',
    LINUX_ARM_V7 = 'linux/arm/v7',
    LINUX_ARM_V6 = 'linux/arm/v6',
    LINUX_ARM64 = 'linux/arm64',
    LINUX_MIPS64LE = 'linux/mips64le',
    LINUX_MIPS64 = 'linux/mips64',
    LINUX_PPC64LE = 'linux/ppc64le',
    LINUX_IBMZ = 'linux/s390x',
}

export function getNativeDockerPlatform(): DOCKER_SUPPORTED_PLATFORMS {
    const arch = process.arch;

    switch (arch) {
        case 'x64': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_X86_64;
        }
        case 'ia32': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_I386;
        }
        case 'arm': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_ARM_V7;
        }
        case 'arm64': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_ARM64;
        }
        case 'mips': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_MIPS64;
        }
        case 'mipsel': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_MIPS64LE;
        }
        case 'ppc64': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_PPC64LE;
        }
        case 's390':
        case 's390x': {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_IBMZ;
        }

        default: {
            return DOCKER_SUPPORTED_PLATFORMS.LINUX_X86_64;
        }
    }
}

export const SERVER_NATIVE_DOCKER_PLATFORM = getNativeDockerPlatform();
